/**
 * x402-batch-codec
 *
 * Standalone codec for decoded Circle Gateway submitBatch evidence on Arc.
 * It does not execute payments or produce cryptographic attestations.
 */

export type {
  BatchEntry,
  NetTransfer,
  DecodedBatch,
  DecodedBatchCalldata,
  DecodedSubmitBatchInput,
  GatewayTransferStatus,
  VerificationLevel,
  ProofStatus,
  MatchedBy,
  X402BatchProof,
  DecodeBatchTxOptions,
  ResolveOptions,
} from "./types.js";

export { SUBMIT_BATCH_ABI } from "./abi.js";
export {
  isEvmTxHash,
  isEvmAddress,
  isBytes32,
  isUuid,
  isSettlementId,
} from "./guards.js";
export { formatSignedUsdc } from "./format.js";
export { inferNetTransfers, buyerInBatch, sellerInBatch } from "./net-transfers.js";
export { decodeSubmitBatchCalldataBytes } from "./decode-submit-batch.js";
export type { DecodeSubmitBatchOptions } from "./decode-submit-batch.js";
export {
  decodeSubmitBatchInput,
  decodeBatchTx,
  decodeBatchTxWithRpc,
} from "./decode-batch-tx.js";
export {
  buildArcExplorerTxUrl,
  safeExplorerUrl,
  findSubmitBatchCandidates,
  findNearestSubmitBatch,
} from "./explorer.js";
export type { SubmitBatchCandidate } from "./explorer.js";
export { encodeBatchProof, decodeBatchProof } from "./proof-codec.js";
export { redactUnsafePaymentText } from "./redaction.js";
export { resolveX402BatchProof } from "./resolver.js";
