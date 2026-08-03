/**
 * Optional resolver adapter for Circle Gateway batch evidence.
 *
 * The resolver separates Gateway transfer status from on-chain verification:
 * timing finds candidates; strict RPC validation produces decoded batch
 * evidence; expected signed deltas can establish address participation only.
 * No raw Gateway responses, signatures, payment headers, or secrets escape.
 */

import { createPublicClient, http, type PublicClient } from "viem";
import { isEvmAddress, isEvmTxHash, isUuid } from "./guards.js";
import {
  buildArcExplorerTxUrl,
  findSubmitBatchCandidates,
  safeExplorerUrl,
  type SubmitBatchCandidate,
} from "./explorer.js";
import { decodeBatchTx } from "./decode-batch-tx.js";
import { buyerInBatch, sellerInBatch } from "./net-transfers.js";
import type {
  DecodedBatch,
  GatewayTransferStatus,
  MatchedBy,
  ResolveOptions,
  VerificationLevel,
  X402BatchProof,
} from "./types.js";

const DEFAULT_GATEWAY_API = "https://gateway-api-testnet.circle.com";
const DEFAULT_ARC_EXPLORER = "https://testnet.arcscan.app";
const DEFAULT_ARC_RPC = "https://rpc.testnet.arc.network";
const DEFAULT_GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const DEFAULT_DOMAIN = 26;
const ACTIVE_GATEWAY_STATUSES = new Set(["completed", "confirmed"]);
const LIMITATIONS = [
  "Circle Gateway transfer status is canonical for the transfer UUID.",
  "Timestamp matching is candidate discovery only.",
  "Buyer/seller delta presence proves address participation in a netted batch, not a unique x402 transfer.",
  "Exact payment amount attribution is not implemented.",
  "Portable evidence metadata is unsigned and is not a cryptographic attestation.",
  "Direct smart-contract verification and an official UUID-to-batch mapping are not provided.",
];

type CandidateSource = "gateway_txhash_field" | "manual_tx" | "timestamp_candidate";
type EvaluatedCandidate = {
  candidate: SubmitBatchCandidate;
  source: CandidateSource;
  decoded: DecodedBatch | null;
  buyerMatched: boolean;
  sellerMatched: boolean;
};

function parseTimestamp(value: string | null): number | null {
  if (!value || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractGatewayTxHash(data: Record<string, unknown>): `0x${string}` | null {
  const transaction = data["transaction"];
  const possibleValues: unknown[] = [
    typeof transaction === "object" && transaction !== null && !Array.isArray(transaction)
      ? (transaction as Record<string, unknown>)["txHash"]
      : undefined,
    data["txHash"],
    transaction,
  ];
  for (const value of possibleValues) {
    if (isEvmTxHash(value)) return value;
  }
  return null;
}

async function fetchGatewayTransferStatus(
  gatewayApiUrl: string,
  settlementId: string,
): Promise<GatewayTransferStatus | null> {
  try {
    const response = await fetch(
      `${gatewayApiUrl}/v1/x402/transfers/${encodeURIComponent(settlementId)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const data = value as Record<string, unknown>;
    return {
      status: typeof data["status"] === "string" ? data["status"] : "unknown",
      fromAddress: typeof data["fromAddress"] === "string" ? data["fromAddress"] : null,
      toAddress: typeof data["toAddress"] === "string" ? data["toAddress"] : null,
      amount: typeof data["amount"] === "string" ? data["amount"] : null,
      token: typeof data["token"] === "string" ? data["token"] : null,
      createdAt: typeof data["createdAt"] === "string" ? data["createdAt"] : null,
      updatedAt: typeof data["updatedAt"] === "string" ? data["updatedAt"] : null,
      transactionHash: extractGatewayTxHash(data),
    };
  } catch {
    return null;
  }
}

function validGatewayWallet(value: string): `0x${string}` | null {
  return isEvmAddress(value) ? value : null;
}

function candidateForHash(
  txHash: `0x${string}`,
  updatedAt: string | null,
  updatedAtMs: number | null,
): SubmitBatchCandidate {
  return {
    txHash,
    timestamp: updatedAt ?? "",
    timestampMs: updatedAtMs ?? 0,
    distanceMs: 0,
  };
}

function makeEmptyProof(
  settlementId: string,
  verificationLevel: VerificationLevel,
  gatewayStatus?: string,
  gatewayWallet?: `0x${string}`,
): X402BatchProof {
  return {
    v: 1,
    settlementId,
    gatewayStatus,
    status: gatewayStatus,
    verificationLevel,
    txHash: null,
    explorerUrl: null,
    gatewayWallet,
    entriesCount: 0,
    netTransfersCount: 0,
    limitations: LIMITATIONS,
  };
}

function buildExplorerUrl(
  txHash: `0x${string}`,
  explorerBase: string,
): string | null {
  return safeExplorerUrl(buildArcExplorerTxUrl(txHash, explorerBase));
}

function chooseDecodedCandidate(
  candidates: EvaluatedCandidate[],
  expectedBuyer?: `0x${string}`,
  expectedSeller?: `0x${string}`,
): EvaluatedCandidate | undefined {
  const decoded = candidates.filter((candidate) => candidate.decoded !== null);
  if (!decoded.length) return undefined;
  if (expectedBuyer && expectedSeller) {
    const both = decoded.find((candidate) => candidate.buyerMatched && candidate.sellerMatched);
    if (both) return both;
    const either = decoded.find((candidate) => candidate.buyerMatched || candidate.sellerMatched);
    if (either) return either;
  } else if (expectedBuyer) {
    const buyer = decoded.find((candidate) => candidate.buyerMatched);
    if (buyer) return buyer;
  } else if (expectedSeller) {
    const seller = decoded.find((candidate) => candidate.sellerMatched);
    if (seller) return seller;
  }
  return decoded[0];
}

function hasRequiredAddressParticipation(
  buyerMatched: boolean,
  sellerMatched: boolean,
  expectedBuyer?: `0x${string}`,
  expectedSeller?: `0x${string}`,
): boolean {
  if (expectedBuyer && expectedSeller) return buyerMatched && sellerMatched;
  if (expectedBuyer) return buyerMatched;
  if (expectedSeller) return sellerMatched;
  return false;
}

/**
 * Resolve a Circle Gateway settlement UUID into portable batch evidence.
 * A timestamp candidate is never upgraded without strict RPC decoding.
 */
export async function resolveX402BatchProof(opts: ResolveOptions): Promise<X402BatchProof> {
  const {
    settlementId,
    gatewayApiUrl = DEFAULT_GATEWAY_API,
    arcExplorerApiUrl = DEFAULT_ARC_EXPLORER,
    expectedBuyer,
    expectedSeller,
    maxPages = 10,
    maxDistanceMs,
    manualTxHash,
  } = opts;
  const gatewayWallet = opts.expectedGatewayWallet ?? opts.gatewayWalletAddress ?? DEFAULT_GATEWAY_WALLET;
  const gatewayWalletTyped = validGatewayWallet(gatewayWallet);

  if (!isUuid(settlementId)) {
    return makeEmptyProof(settlementId, "unresolved", undefined, gatewayWalletTyped ?? undefined);
  }

  const gatewayStatus = await fetchGatewayTransferStatus(gatewayApiUrl, settlementId);
  if (!gatewayStatus) {
    return makeEmptyProof(
      settlementId,
      "unresolved",
      undefined,
      gatewayWalletTyped ?? undefined,
    );
  }

  const gatewayStatusText = gatewayStatus.status;
  const normalizedStatus = gatewayStatusText.toLowerCase();
  const baseProof = {
    gatewayStatus: gatewayStatusText,
    status: gatewayStatusText,
    gatewayWallet: gatewayWalletTyped ?? undefined,
  };

  if (!ACTIVE_GATEWAY_STATUSES.has(normalizedStatus)) {
    return {
      ...makeEmptyProof(
        settlementId,
        "unresolved",
        gatewayStatusText,
        gatewayWalletTyped ?? undefined,
      ),
      ...baseProof,
    };
  }

  const updatedAtMs = parseTimestamp(gatewayStatus.updatedAt);
  const candidates: { candidate: SubmitBatchCandidate; source: CandidateSource }[] = [];
  if (gatewayStatus.transactionHash) {
    candidates.push({
      candidate: candidateForHash(
        gatewayStatus.transactionHash,
        gatewayStatus.updatedAt,
        updatedAtMs,
      ),
      source: "gateway_txhash_field",
    });
  }
  if (manualTxHash && isEvmTxHash(manualTxHash)) {
    candidates.push({
      candidate: candidateForHash(manualTxHash, gatewayStatus.updatedAt, updatedAtMs),
      source: "manual_tx",
    });
  }
  if (gatewayWalletTyped && updatedAtMs !== null) {
    try {
      const explorerCandidates = await findSubmitBatchCandidates(
        arcExplorerApiUrl,
        gatewayWalletTyped,
        updatedAtMs,
        maxPages,
        maxDistanceMs,
      );
      const known = new Set(candidates.map(({ candidate }) => candidate.txHash.toLowerCase()));
      for (const candidate of explorerCandidates) {
        if (!known.has(candidate.txHash.toLowerCase())) {
          candidates.push({ candidate, source: "timestamp_candidate" });
        }
      }
    } catch {
      // Candidate discovery is best-effort; a Gateway hash/manual hash can still be decoded.
    }
  }

  if (!candidates.length) {
    return {
      ...makeEmptyProof(settlementId, "unresolved", gatewayStatusText, gatewayWalletTyped ?? undefined),
      ...baseProof,
    };
  }

  let client: PublicClient;
  try {
    client = opts.rpcClient ?? createPublicClient({ transport: http(opts.rpcUrl ?? DEFAULT_ARC_RPC) });
  } catch {
    return {
      ...makeEmptyProof(settlementId, "timestamp_candidate", gatewayStatusText, gatewayWalletTyped ?? undefined),
      ...baseProof,
      txHash: candidates[0]!.candidate.txHash,
      explorerUrl: buildExplorerUrl(candidates[0]!.candidate.txHash, arcExplorerApiUrl),
      matchedBy: candidates[0]!.source,
    };
  }

  const evaluated: EvaluatedCandidate[] = [];
  for (const { candidate, source } of candidates) {
    const decoded = await decodeBatchTx(candidate.txHash, client, {
      requireReceipt: true,
      expectedGatewayWallet: gatewayWalletTyped ?? undefined,
      expectedDomain: opts.expectedDomain ?? DEFAULT_DOMAIN,
      expectedToken: opts.expectedToken,
    });
    const buyerMatched = decoded && expectedBuyer
      ? buyerInBatch(decoded, expectedBuyer).found
      : false;
    const sellerMatched = decoded && expectedSeller
      ? sellerInBatch(decoded, expectedSeller).found
      : false;
    evaluated.push({ candidate, source, decoded, buyerMatched, sellerMatched });
  }

  const selectedDecoded = chooseDecodedCandidate(evaluated, expectedBuyer, expectedSeller);
  const selected = selectedDecoded ?? evaluated[0]!;
  if (!selected.decoded) {
    return {
      ...makeEmptyProof(
        settlementId,
        "timestamp_candidate",
        gatewayStatusText,
        gatewayWalletTyped ?? undefined,
      ),
      ...baseProof,
      txHash: selected.candidate.txHash,
      explorerUrl: buildExplorerUrl(selected.candidate.txHash, arcExplorerApiUrl),
      matchedBy: selected.source,
    };
  }

  const decoded = selected.decoded;
  const addressParticipation = hasRequiredAddressParticipation(
    selected.buyerMatched,
    selected.sellerMatched,
    expectedBuyer,
    expectedSeller,
  );
  const verificationLevel: VerificationLevel = addressParticipation
    ? "address_participation"
    : "decoded_batch";
  const matchedBy: MatchedBy | undefined =
    selected.source === "gateway_txhash_field"
      ? "gateway_txhash_field"
      : selected.source === "manual_tx"
        ? "manual_tx"
        : expectedBuyer || expectedSeller
          ? "decoded_delta"
          : undefined;
  const buyerCheck = expectedBuyer ? buyerInBatch(decoded, expectedBuyer) : undefined;
  const sellerCheck = expectedSeller ? sellerInBatch(decoded, expectedSeller) : undefined;

  return {
    v: 1,
    settlementId,
    ...baseProof,
    verificationLevel,
    matchedBy,
    txHash: selected.candidate.txHash,
    explorerUrl: buildExplorerUrl(selected.candidate.txHash, arcExplorerApiUrl),
    batchId: decoded.batchId,
    domain: decoded.domain,
    token: decoded.token,
    entriesCount: decoded.entries.length,
    netTransfersCount: decoded.netTransfers.length,
    buyerVerified: expectedBuyer ? buyerCheck!.found : undefined,
    sellerVerified: expectedSeller ? sellerCheck!.found : undefined,
    buyerEntry: buyerCheck?.entry
      ? { address: buyerCheck.entry.address, usdc: buyerCheck.entry.usdc }
      : undefined,
    sellerEntry: sellerCheck?.entry
      ? { address: sellerCheck.entry.address, usdc: sellerCheck.entry.usdc }
      : undefined,
    limitations: LIMITATIONS,
  };
}
