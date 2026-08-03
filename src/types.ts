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

/** Gateway transfer status from Circle's public API. Safe fields only. */
export type GatewayTransferStatus = {
  status: string;
  fromAddress: string | null;
  toAddress: string | null;
  amount: string | null;
  token: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** A validated transaction hash extracted from supported Gateway fields. */
  transactionHash: `0x${string}` | null;
};

/** Resolver verification state, deliberately separate from Gateway status. */
export type VerificationLevel =
  | "unresolved"
  | "timestamp_candidate"
  | "decoded_batch"
  | "address_participation";

/**
 * Legacy status field retained for source compatibility. New code should use
 * gatewayStatus and verificationLevel separately.
 */
export type ProofStatus = string;

/** How the batch tx was matched. */
export type MatchedBy =
  | "gateway_txhash_field"
  | "timestamp_candidate"
  | "decoded_delta"
  | "manual_tx";

/**
 * Portable batch evidence metadata. This is unsigned metadata, not a
 * cryptographic proof, attestation, or smart-contract verification result.
 */
export type X402BatchProof = {
  v: 1;
  settlementId?: string;

  /** Canonical Circle Gateway transfer status, when fetched. */
  gatewayStatus?: string;
  /** @deprecated Use gatewayStatus and verificationLevel. */
  status?: ProofStatus;
  verificationLevel: VerificationLevel;
  matchedBy?: MatchedBy;

  txHash: `0x${string}` | null;
  explorerUrl: string | null;

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

/** Options for the optional resolver adapter. */
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
  /** Optional operator-supplied transaction hash, never fetched from raw input. */
  manualTxHash?: string;
};
