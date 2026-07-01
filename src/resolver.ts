/**
 * Optional resolver adapter — resolves a Circle Gateway settlement UUID
 * to an on-chain submitBatch tx hash and verified proof.
 *
 * This module makes external HTTP calls:
 *   1. Circle Gateway API (public, no API key)
 *   2. Arc explorer API (public)
 *   3. Arc RPC (viem PublicClient)
 *
 * Returns only safe proof metadata. Never returns raw Gateway responses,
 * payment signatures, or secrets.
 *
 * TIMESTAMP MATCHING IS CANDIDATE DISCOVERY ONLY.
 * Decoded batch deltas are the proof signal when expected addresses are provided.
 */

import { createPublicClient, http, type PublicClient } from "viem";
import { isUuid, isEvmTxHash } from "./guards.js";
import { buildArcExplorerTxUrl, findNearestSubmitBatch } from "./explorer.js";
import { decodeBatchTx } from "./decode-batch-tx.js";
import { buyerInBatch, sellerInBatch } from "./net-transfers.js";
import type {
  X402BatchProof,
  ResolveOptions,
  GatewayTransferStatus,
  MatchedBy,
} from "./types.js";

const DEFAULT_GATEWAY_API = "https://gateway-api-testnet.circle.com";
const DEFAULT_ARC_EXPLORER = "https://testnet.arcscan.app";
const DEFAULT_GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const DEFAULT_MAX_PAGES = 10;

/**
 * Fetch safe transfer status from Circle Gateway public API.
 * Returns null if the fetch fails or response is malformed.
 */
async function fetchGatewayTransferStatus(
  gatewayApiUrl: string,
  settlementId: string,
): Promise<GatewayTransferStatus | null> {
  try {
    const resp = await fetch(
      `${gatewayApiUrl}/v1/x402/transfers/${encodeURIComponent(settlementId)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!resp.ok) return null;

    const data = (await resp.json()) as Record<string, unknown>;

    return {
      status: typeof data["status"] === "string" ? data["status"] : "unknown",
      fromAddress:
        typeof data["fromAddress"] === "string" ? data["fromAddress"] : null,
      toAddress:
        typeof data["toAddress"] === "string" ? data["toAddress"] : null,
      amount: typeof data["amount"] === "string" ? data["amount"] : null,
      token: typeof data["token"] === "string" ? data["token"] : null,
      createdAt:
        typeof data["createdAt"] === "string" ? data["createdAt"] : null,
      updatedAt:
        typeof data["updatedAt"] === "string" ? data["updatedAt"] : null,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a Circle Gateway settlement UUID to a verified on-chain batch proof.
 *
 * Resolution strategy:
 *   1. Fetch Gateway transfer status (safe fields only)
 *   2. If status not completed/confirmed → return unresolved
 *   3. Scan Arc explorer for submitBatch candidate (timestamp-based)
 *   4. Decode candidate tx calldata
 *   5. If expectedBuyer/Seller provided → verify via decoded delta evidence
 *
 * Timestamp matching alone is NOT proof. Decoded buyer/seller deltas are the proof signal.
 */
export async function resolveX402BatchProof(
  opts: ResolveOptions,
): Promise<X402BatchProof> {
  const {
    settlementId,
    gatewayApiUrl = DEFAULT_GATEWAY_API,
    arcExplorerApiUrl = DEFAULT_ARC_EXPLORER,
    gatewayWalletAddress = DEFAULT_GATEWAY_WALLET,
    expectedBuyer,
    expectedSeller,
    rpcUrl,
    maxPages = DEFAULT_MAX_PAGES,
  } = opts;

  // Validate settlement UUID
  if (!isUuid(settlementId)) {
    return makeEmptyProof("unresolved", settlementId);
  }

  // Fetch Gateway transfer status
  const gwStatus = await fetchGatewayTransferStatus(gatewayApiUrl, settlementId);

  if (!gwStatus) {
    return makeEmptyProof("gateway_fetch_failed", settlementId);
  }

  const status = gwStatus.status.toLowerCase();
  const completedStatuses = new Set(["completed", "confirmed"]);
  if (!completedStatuses.has(status)) {
    return {
      ...makeEmptyProof("unresolved", settlementId),
      status: status as X402BatchProof["status"],
    };
  }

  // Scan Arc explorer for submitBatch candidate
  const updatedAtMs = gwStatus.updatedAt
    ? new Date(gwStatus.updatedAt).getTime()
    : Date.now();

  let txHash: string | null = null;
  let matchedBy: MatchedBy = "timestamp_candidate";

  try {
    txHash = await findNearestSubmitBatch(
      arcExplorerApiUrl,
      gatewayWalletAddress,
      updatedAtMs,
      maxPages,
    );
  } catch {
    // Explorer scan failed — continue with no tx
  }

  if (!txHash) {
    return {
      ...makeEmptyProof("unresolved", settlementId),
      gatewayWallet: gatewayWalletAddress as `0x${string}`,
    };
  }

  // Decode candidate tx
  let decoded: Awaited<ReturnType<typeof decodeBatchTx>> = null;
  if (rpcUrl) {
    const client = createPublicClient({ transport: http(rpcUrl) });
    decoded = await decodeBatchTx(txHash, client);
  }

  // Verify buyer/seller if expected addresses provided
  let buyerVerified = false;
  let sellerVerified = false;
  let buyerEntry: X402BatchProof["buyerEntry"];
  let sellerEntry: X402BatchProof["sellerEntry"];

  if (decoded) {
    if (expectedBuyer) {
      const check = buyerInBatch(decoded, expectedBuyer);
      buyerVerified = check.found;
      if (check.entry) {
        buyerEntry = { address: check.entry.address, usdc: check.entry.usdc };
      }
    }
    if (expectedSeller) {
      const check = sellerInBatch(decoded, expectedSeller);
      sellerVerified = check.found;
      if (check.entry) {
        sellerEntry = { address: check.entry.address, usdc: check.entry.usdc };
      }
    }

    // If buyer+seller verified via delta evidence, upgrade matchedBy
    if (
      (expectedBuyer && buyerVerified) ||
      (expectedSeller && sellerVerified)
    ) {
      matchedBy = "decoded_delta";
    }
  }

  const explorerUrl = buildArcExplorerTxUrl(txHash, arcExplorerApiUrl);

  return {
    v: 1,
    settlementId,
    status: "completed",
    txHash: txHash as `0x${string}`,
    explorerUrl,
    batchId: decoded?.batchId,
    domain: decoded?.domain,
    token: decoded?.token,
    gatewayWallet: gatewayWalletAddress as `0x${string}`,
    entriesCount: decoded?.entries.length ?? 0,
    netTransfersCount: decoded?.netTransfers.length ?? 0,
    buyerVerified: expectedBuyer ? buyerVerified : undefined,
    sellerVerified: expectedSeller ? sellerVerified : undefined,
    buyerEntry,
    sellerEntry,
    matchedBy,
  };
}

function makeEmptyProof(
  status: X402BatchProof["status"],
  settlementId?: string,
): X402BatchProof {
  return {
    v: 1,
    settlementId,
    status,
    txHash: null,
    explorerUrl: null,
    entriesCount: 0,
    netTransfersCount: 0,
  };
}
