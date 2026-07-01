/**
 * Public types for x402-batch-codec.
 *
 * No secrets. No raw signatures. No payment headers.
 */

/** A single entry in a decoded submitBatch calldata. */
export type BatchEntry = {
  address: `0x${string}`;
  delta: bigint;
  /** Human-readable USDC amount (e.g. "-0.010000", "+1.000000"). */
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
};

/** Proof status for a resolved batch settlement. */
export type ProofStatus =
  | "completed"
  | "confirmed"
  | "unresolved"
  | "gateway_fetch_failed";

/** How the batch tx was matched. */
export type MatchedBy =
  | "decoded_delta"
  | "timestamp_candidate"
  | "gateway_txhash_field"
  | "manual_tx";

/**
 * Safe proof object — encodes verifiable batch inclusion metadata.
 * Never contains raw signatures, payment headers, or secrets.
 */
export type X402BatchProof = {
  /** Proof schema version. */
  v: 1;
  settlementId?: string;
  status?: ProofStatus;
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
  buyerEntry?: { address: `0x${string}`; usdc: string };
  sellerEntry?: { address: `0x${string}`; usdc: string };
  matchedBy?: MatchedBy;
};

/** Options for the optional resolver adapter. */
export type ResolveOptions = {
  settlementId: string;
  gatewayApiUrl?: string;
  arcExplorerApiUrl?: string;
  gatewayWalletAddress?: string;
  expectedBuyer?: `0x${string}`;
  expectedSeller?: `0x${string}`;
  rpcUrl?: string;
  maxPages?: number;
};
