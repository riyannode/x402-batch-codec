/**
 * Resolve Circle Gateway x402 transfer metadata into portable batch evidence.
 *
 * The resolver treats Circle's valid top-level txHash as the authoritative
 * batch mapping. Timestamp discovery is an explicitly opt-in legacy heuristic.
 * No raw Gateway response, signature, payment header, or secret escapes.
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
  GatewayTransferStatusValue,
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
const GATEWAY_STATUSES = new Set<GatewayTransferStatusValue>([
  "received",
  "batched",
  "confirmed",
  "completed",
  "failed",
]);
const LEGACY_FALLBACK_STATUSES = new Set<GatewayTransferStatusValue>([
  "batched",
  "confirmed",
  "completed",
]);
const LIMITATIONS = [
  "Circle Gateway provides an off-chain HTTP mapping from a transfer UUID to a batch-level txHash; the response is not a signed attestation.",
  "RPC validation is required to inspect the actual Arc transaction.",
  "Gateway batch settlement may use net balance deltas.",
  "Buyer/seller delta presence proves address participation in a netted batch, not a unique one-to-one transfer.",
  "Exact payment amount attribution is not derived from net deltas.",
  "Portable unsigned metadata is not a cryptographic proof, signed Circle attestation, or Solidity-verifiable receipt.",
  "Timestamp matching is retained only as an optional legacy heuristic.",
];

type CandidateSource = "gateway_txhash_field" | "manual_tx" | "legacy_timestamp_candidate";
type EvaluatedCandidate = {
  candidate: SubmitBatchCandidate;
  source: CandidateSource;
  decoded: DecodedBatch | null;
  buyerMatched: boolean;
  sellerMatched: boolean;
};

type GatewayMetadata = Pick<
  X402BatchProof,
  | "transferId"
  | "settlementId"
  | "gatewayStatus"
  | "status"
  | "sendingNetwork"
  | "recipientNetwork"
  | "fromAddress"
  | "toAddress"
  | "amountAtomic"
  | "nonce"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTimestamp(value: string | null): number | null {
  if (!value || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : typeof value === "string"
      ? value
      : null;
}

function nullableNetwork(value: unknown): string | null {
  const parsed = nullableString(value);
  return parsed && parsed.trim() ? parsed : null;
}

function nullableAddress(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return isEvmAddress(value) ? value : null;
}

function nullableAtomicAmount(value: unknown): string | null {
  const parsed = nullableString(value);
  return parsed && /^[0-9]+$/.test(parsed) ? parsed : null;
}

function nullableNonce(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  const parsed = nullableString(value);
  return parsed && /^[0-9]+$/.test(parsed) ? parsed : null;
}

function optionalFieldValid(
  data: Record<string, unknown>,
  key: string,
  validator: (value: unknown) => boolean,
): boolean {
  return !(key in data) || data[key] === null || validator(data[key]);
}

function validTimestamp(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function malformedTopLevelTxHash(data: Record<string, unknown>): boolean {
  const value = data["txHash"];
  return "txHash" in data && value !== null && value !== undefined && !isEvmTxHash(value);
}

function extractGatewayTxHash(data: Record<string, unknown>): `0x${string}` | null {
  // A present non-null top-level field is authoritative. If malformed, the
  // caller rejects the response rather than silently replacing it with a
  // compatibility field.
  if (isEvmTxHash(data["txHash"])) return data["txHash"];
  if (malformedTopLevelTxHash(data)) return null;

  // Compatibility with older Gateway response shapes when the official field
  // is absent or explicitly null.
  const transaction = data["transaction"];
  if (isRecord(transaction) && isEvmTxHash(transaction["txHash"])) {
    return transaction["txHash"];
  }
  if (isEvmTxHash(transaction)) return transaction;
  return null;
}

function parseGatewayTransfer(
  value: unknown,
  requestedId: string,
): GatewayTransferStatus | null {
  if (!isRecord(value)) return null;
  const id = value["id"];
  if (typeof id !== "string" || id !== requestedId) return null;
  const status = value["status"];
  if (typeof status !== "string" || !GATEWAY_STATUSES.has(status as GatewayTransferStatusValue)) {
    return null;
  }
  if (malformedTopLevelTxHash(value)) return null;
  if (!optionalFieldValid(value, "token", (field) => typeof field === "string" && field.trim().length > 0)) return null;
  if (!optionalFieldValid(value, "sendingNetwork", (field) => typeof field === "string" && field.trim().length > 0)) return null;
  if (!optionalFieldValid(value, "recipientNetwork", (field) => typeof field === "string" && field.trim().length > 0)) return null;
  if (!optionalFieldValid(value, "fromAddress", isEvmAddress)) return null;
  if (!optionalFieldValid(value, "toAddress", isEvmAddress)) return null;
  if (!optionalFieldValid(value, "amount", (field) => typeof field === "string" && /^[0-9]+$/.test(field))) return null;
  if (!optionalFieldValid(value, "nonce", (field) =>
    (typeof field === "number" && Number.isSafeInteger(field) && field >= 0) ||
    (typeof field === "string" && /^[0-9]+$/.test(field)),
  )) return null;
  if (!optionalFieldValid(value, "createdAt", validTimestamp)) return null;
  if (!optionalFieldValid(value, "updatedAt", validTimestamp)) return null;

  return {
    id,
    status: status as GatewayTransferStatusValue,
    token: nullableString(value["token"]),
    sendingNetwork: nullableNetwork(value["sendingNetwork"]),
    recipientNetwork: nullableNetwork(value["recipientNetwork"]),
    fromAddress: nullableAddress(value["fromAddress"]),
    toAddress: nullableAddress(value["toAddress"]),
    amount: nullableAtomicAmount(value["amount"]),
    nonce: nullableNonce(value["nonce"]),
    txHash: extractGatewayTxHash(value),
    createdAt: nullableString(value["createdAt"]),
    updatedAt: nullableString(value["updatedAt"]),
  };
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
    return parseGatewayTransfer(await response.json(), settlementId);
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

function gatewayMetadata(transfer: GatewayTransferStatus): GatewayMetadata {
  return {
    transferId: transfer.id,
    settlementId: transfer.id,
    gatewayStatus: transfer.status,
    status: transfer.status,
    ...(transfer.sendingNetwork ? { sendingNetwork: transfer.sendingNetwork } : {}),
    ...(transfer.recipientNetwork ? { recipientNetwork: transfer.recipientNetwork } : {}),
    ...(transfer.fromAddress ? { fromAddress: transfer.fromAddress as `0x${string}` } : {}),
    ...(transfer.toAddress ? { toAddress: transfer.toAddress as `0x${string}` } : {}),
    ...(transfer.amount ? { amountAtomic: transfer.amount } : {}),
    ...(transfer.nonce ? { nonce: transfer.nonce } : {}),
  };
}

function makeEmptyProof(
  settlementId: string,
  verificationLevel: VerificationLevel,
  gateway?: GatewayTransferStatus,
  gatewayWallet?: `0x${string}`,
): X402BatchProof {
  return {
    v: 1,
    ...(gateway ? gatewayMetadata(gateway) : { settlementId }),
    verificationLevel,
    txHash: null,
    explorerUrl: null,
    ...(gatewayWallet ? { gatewayWallet } : {}),
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

function unresolvedCandidateProof(
  settlementId: string,
  transfer: GatewayTransferStatus,
  gatewayWallet: `0x${string}` | null,
  selected: EvaluatedCandidate,
  explorerBase: string,
): X402BatchProof {
  const official = selected.source === "gateway_txhash_field";
  return {
    ...makeEmptyProof(
      settlementId,
      official ? "official_batch_mapping" : selected.source === "legacy_timestamp_candidate"
        ? "legacy_timestamp_candidate"
        : "unresolved",
      transfer,
      gatewayWallet ?? undefined,
    ),
    txHash: selected.candidate.txHash,
    explorerUrl: buildExplorerUrl(selected.candidate.txHash, explorerBase),
    ...(official ? { officialBatchTxHash: selected.candidate.txHash } : {}),
    matchedBy: official ? "gateway_txhash_field" : selected.source === "manual_tx"
      ? "manual_tx"
      : "legacy_timestamp_candidate",
  };
}

/**
 * Resolve a Circle Gateway transfer UUID into portable unsigned batch evidence.
 * A valid official Circle txHash is authoritative and is never replaced by an
 * explorer timestamp candidate.
 */
export async function resolveX402BatchProof(opts: ResolveOptions): Promise<X402BatchProof> {
  const {
    settlementId,
    gatewayApiUrl = DEFAULT_GATEWAY_API,
    arcExplorerApiUrl = DEFAULT_ARC_EXPLORER,
    expectedBuyer: rawExpectedBuyer,
    expectedSeller: rawExpectedSeller,
    maxPages = 10,
    maxDistanceMs,
    manualTxHash,
    allowLegacyTimestampFallback = false,
  } = opts;
  const gatewayWallet = opts.expectedGatewayWallet ?? opts.gatewayWalletAddress ?? DEFAULT_GATEWAY_WALLET;
  const gatewayWalletTyped = validGatewayWallet(gatewayWallet);
  const expectedBuyer = isEvmAddress(rawExpectedBuyer) ? rawExpectedBuyer : undefined;
  const expectedSeller = isEvmAddress(rawExpectedSeller) ? rawExpectedSeller : undefined;

  if (!isUuid(settlementId)) {
    return makeEmptyProof(settlementId, "unresolved", undefined, gatewayWalletTyped ?? undefined);
  }

  const gatewayTransfer = await fetchGatewayTransferStatus(gatewayApiUrl, settlementId);
  if (!gatewayTransfer) {
    return makeEmptyProof(
      settlementId,
      "unresolved",
      undefined,
      gatewayWalletTyped ?? undefined,
    );
  }

  // received and failed are terminal non-resolution states for this resolver.
  // In particular, a received transfer is not eligible for timestamp guessing.
  if (!LEGACY_FALLBACK_STATUSES.has(gatewayTransfer.status)) {
    return makeEmptyProof(
      settlementId,
      "unresolved",
      gatewayTransfer,
      gatewayWalletTyped ?? undefined,
    );
  }

  const updatedAtMs = parseTimestamp(gatewayTransfer.updatedAt);
  const officialTxHash = gatewayTransfer.txHash;
  const candidates: { candidate: SubmitBatchCandidate; source: CandidateSource }[] = [];

  if (officialTxHash) {
    candidates.push({
      candidate: candidateForHash(officialTxHash, gatewayTransfer.updatedAt, updatedAtMs),
      source: "gateway_txhash_field",
    });
  } else if (manualTxHash && isEvmTxHash(manualTxHash)) {
    candidates.push({
      candidate: candidateForHash(manualTxHash, gatewayTransfer.updatedAt, updatedAtMs),
      source: "manual_tx",
    });
  }

  // This is intentionally opt-in. A valid official hash takes the branch above
  // and can never trigger discovery or be replaced by a discovered candidate.
  if (
    !officialTxHash &&
    allowLegacyTimestampFallback &&
    gatewayWalletTyped &&
    updatedAtMs !== null
  ) {
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
          candidates.push({ candidate, source: "legacy_timestamp_candidate" });
        }
      }
    } catch {
      // Legacy candidate discovery is best effort and never changes official data.
    }
  }

  if (!candidates.length) {
    return makeEmptyProof(
      settlementId,
      "unresolved",
      gatewayTransfer,
      gatewayWalletTyped ?? undefined,
    );
  }

  // A configured invalid Gateway wallet cannot produce strict decoded evidence.
  // For an official mapping, preserve the official hash at its off-chain level.
  if (!gatewayWalletTyped) {
    return unresolvedCandidateProof(
      settlementId,
      gatewayTransfer,
      gatewayWalletTyped,
      {
        candidate: candidates[0]!.candidate,
        source: candidates[0]!.source,
        decoded: null,
        buyerMatched: false,
        sellerMatched: false,
      },
      arcExplorerApiUrl,
    );
  }

  let client: PublicClient;
  try {
    client = opts.rpcClient ?? createPublicClient({ transport: http(opts.rpcUrl ?? DEFAULT_ARC_RPC) });
  } catch {
    return unresolvedCandidateProof(
      settlementId,
      gatewayTransfer,
      gatewayWalletTyped,
      {
        candidate: candidates[0]!.candidate,
        source: candidates[0]!.source,
        decoded: null,
        buyerMatched: false,
        sellerMatched: false,
      },
      arcExplorerApiUrl,
    );
  }

  const evaluated: EvaluatedCandidate[] = [];
  for (const { candidate, source } of candidates) {
    let decoded: DecodedBatch | null = null;
    try {
      decoded = await decodeBatchTx(candidate.txHash, client, {
        requireReceipt: true,
        expectedGatewayWallet: gatewayWalletTyped,
        expectedDomain: opts.expectedDomain ?? DEFAULT_DOMAIN,
        expectedToken: opts.expectedToken,
      });
    } catch {
      decoded = null;
    }
    const buyerMatched = decoded && expectedBuyer
      ? buyerInBatch(decoded, expectedBuyer).found
      : false;
    const sellerMatched = decoded && expectedSeller
      ? sellerInBatch(decoded, expectedSeller).found
      : false;
    evaluated.push({ candidate, source, decoded, buyerMatched, sellerMatched });

    // Official Circle mapping has absolute priority: only this transaction is
    // decoded, and failure remains official_batch_mapping.
    if (source === "gateway_txhash_field") break;
  }

  const selectedDecoded = chooseDecodedCandidate(evaluated, expectedBuyer, expectedSeller);
  const selected = selectedDecoded ?? evaluated[0]!;
  if (!selected.decoded) {
    return unresolvedCandidateProof(
      settlementId,
      gatewayTransfer,
      gatewayWalletTyped,
      selected,
      arcExplorerApiUrl,
    );
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
  const matchedBy: MatchedBy = selected.source === "gateway_txhash_field"
    ? "gateway_txhash_field"
    : selected.source === "manual_tx"
      ? "manual_tx"
      : addressParticipation
        ? "decoded_delta"
        : "legacy_timestamp_candidate";
  const buyerCheck = expectedBuyer ? buyerInBatch(decoded, expectedBuyer) : undefined;
  const sellerCheck = expectedSeller ? sellerInBatch(decoded, expectedSeller) : undefined;

  return {
    v: 1,
    ...gatewayMetadata(gatewayTransfer),
    verificationLevel,
    matchedBy,
    txHash: selected.candidate.txHash,
    ...(selected.source === "gateway_txhash_field"
      ? { officialBatchTxHash: selected.candidate.txHash }
      : {}),
    explorerUrl: buildExplorerUrl(selected.candidate.txHash, arcExplorerApiUrl),
    gatewayWallet: gatewayWalletTyped,
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
