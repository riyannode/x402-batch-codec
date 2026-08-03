/**
 * Public types for x402-batch-codec.
 *
 * No secrets, raw signatures, payment headers, or private-key material.
 */

/** A single entry in a decoded submitBatch calldata. */
export type BatchEntry = {
  address: `0x${string}`;
  delta: bigint;
  /** Human-readable USDC amount (e.g. "-0.010000", "1.000000"). */
  usdc: string;
};

/** A net transfer inferred by pairing exact-opposite deltas. */
export type NetTransfer = {
  from: `0x${string}`;
  to: `0x${string}`;
  usdc: string;
};

/** Result of decoding a submitBatch on-chain tx. */
export type DecodedBatch = {
  txHash: `0x${string}`;
  blockNumber: bigint;
  blockTimestamp: number;
  relayer: `0x${string}`;
  contract: `0x${string}`;
  batchId: `0x${string}`;
  domain: number;
  token: `0x${string}`;
  innerContract: `0x${string}`;
  entries: BatchEntry[];
  netTransfers: NetTransfer[];
};

/** Result of decoding only the inner calldataBytes (no RPC needed). */
export type DecodedBatchCalldata = {
  batchId: `0x${string}`;
  domain: number;
  token: `0x${string}`;
  innerContract: `0x${string}`;
  entries: BatchEntry[];
};

/** Result of decoding the outer submitBatch input (no RPC needed). */
export type DecodedSubmitBatchInput = {
  calldataBytes: `0x${string}`;
  hasSignature: boolean;
  signatureBytesLength: number;
};

/** Status values currently returned by Circle Gateway's x402 transfer API. */
export type GatewayTransferStatusValue =
  | "received"
  | "batched"
  | "confirmed"
  | "completed"
  | "failed";

/**
 * Safe canonical fields parsed from Circle's transfer response.
 * The raw response and unsupported fields are never returned by this package.
 */
export type GatewayTransferStatus = {
  id: string;
  status: GatewayTransferStatusValue;
  token: string | null;
  sendingNetwork: string | null;
  recipientNetwork: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  amount: string | null;
  nonce: `0x${string}` | null;
  txHash: `0x${string}` | null;
  createdAt: string | null;
  updatedAt: string | null;
};

/** Resolver evidence strength, separate from the Circle transfer status. */
export type VerificationLevel =
  | "unresolved"
  | "official_batch_mapping"
  | "legacy_timestamp_candidate"
  | "decoded_batch"
  | "address_participation";

/**
 * Legacy status field retained for source compatibility. New code should use
 * gatewayStatus and verificationLevel separately.
 */
export type ProofStatus = string;

/** How the selected batch transaction was matched. */
export type MatchedBy =
  | "gateway_txhash_field"
  | "manual_tx"
  | "decoded_delta"
  | "legacy_timestamp_candidate";

/**
 * Portable unsigned batch evidence metadata.
 *
 * This is not a cryptographic proof, a signed Circle attestation, a
 * Solidity-verifiable receipt, or an authoritative one-to-one transfer proof.
 */
export type X402BatchProof = {
  v: 1;
  /** Canonical Circle transfer UUID. */
  transferId?: string;
  /** Backward-compatible alias for transferId. */
  settlementId?: string;

  /** Canonical Circle Gateway status, when safely parsed. */
  gatewayStatus?: GatewayTransferStatusValue;
  /** @deprecated Use gatewayStatus and verificationLevel. */
  status?: ProofStatus;
  verificationLevel: VerificationLevel;
  matchedBy?: MatchedBy;

  /** Selected transaction, if any. */
  txHash: `0x${string}` | null;
  /** Official top-level Circle batch settlement hash, if supplied and valid. */
  officialBatchTxHash?: `0x${string}`;
  explorerUrl: string | null;

  sendingNetwork?: string;
  recipientNetwork?: string;
  fromAddress?: `0x${string}`;
  toAddress?: `0x${string}`;
  amountAtomic?: string;
  nonce?: `0x${string}`;

  batchId?: `0x${string}`;
  domain?: number;
  token?: `0x${string}`;
  gatewayWallet?: `0x${string}`;

  entriesCount: number;
  netTransfersCount: number;

  buyerVerified?: boolean;
  sellerVerified?: boolean;

  buyerEntry?: {
    address: `0x${string}`;
    usdc: string;
  };

  sellerEntry?: {
    address: `0x${string}`;
    usdc: string;
  };

  limitations?: string[];
};

import type { PublicClient } from "viem";

/** Optional strict context validation for decodeBatchTx. */
export type DecodeBatchTxOptions = {
  requireReceipt?: boolean;
  expectedGatewayWallet?: string;
  expectedDomain?: number;
  expectedToken?: string;
};

/** Options for resolving a Circle Gateway x402 transfer into safe evidence. */
export type ResolveOptions = {
  settlementId: string;
  gatewayApiUrl?: string;
  arcExplorerApiUrl?: string;
  /** @deprecated Use expectedGatewayWallet. */
  gatewayWalletAddress?: string;
  expectedGatewayWallet?: string;
  expectedDomain?: number;
  expectedToken?: string;
  expectedBuyer?: `0x${string}`;
  expectedSeller?: `0x${string}`;
  rpcUrl?: string;
  /** Injectable RPC client for deterministic tests and custom transports. */
  rpcClient?: PublicClient;
  maxPages?: number;
  maxDistanceMs?: number;
  /** Enable the explicitly legacy Arc explorer timestamp heuristic. */
  allowLegacyTimestampFallback?: boolean;
  /** Optional operator-supplied transaction hash. */
  manualTxHash?: string;
};
