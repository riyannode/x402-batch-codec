/**
 * x402-batch-codec
 *
 * Standalone codec for Circle Gateway x402 submitBatch transactions.
 * Decode, verify, and prove batch inclusions without executing payments.
 */

// Types
export type {
  BatchEntry,
  NetTransfer,
  DecodedBatch,
  DecodedBatchCalldata,
  DecodedSubmitBatchInput,
  GatewayTransferStatus,
  ProofStatus,
  MatchedBy,
  X402BatchProof,
  ResolveOptions,
} from "./types.js";

// ABI
export { SUBMIT_BATCH_ABI } from "./abi.js";

// Guards
export { isEvmTxHash, isUuid, isSettlementId } from "./guards.js";

// Format
export { formatSignedUsdc } from "./format.js";

// Net transfers
export { inferNetTransfers, buyerInBatch, sellerInBatch } from "./net-transfers.js";

// Decode
export { decodeSubmitBatchCalldataBytes } from "./decode-submit-batch.js";
export {
  decodeSubmitBatchInput,
  decodeBatchTx,
  decodeBatchTxWithRpc,
} from "./decode-batch-tx.js";

// Explorer
export {
  buildArcExplorerTxUrl,
  safeExplorerUrl,
  findNearestSubmitBatch,
} from "./explorer.js";

// Proof codec
export { encodeBatchProof, decodeBatchProof } from "./proof-codec.js";

// Redaction
export { redactUnsafePaymentText } from "./redaction.js";

// Resolver (optional adapter)
export { resolveX402BatchProof } from "./resolver.js";
