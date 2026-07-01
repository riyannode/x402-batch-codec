/**
 * ABI declaration for submitBatch(bytes calldataBytes, bytes signature).
 *
 * This is the outer function on the GatewayWallet contract.
 * The inner calldataBytes layout is decoded separately by decode-submit-batch.ts.
 */

import { parseAbi } from "viem";

export const SUBMIT_BATCH_ABI = parseAbi([
  "function submitBatch(bytes calldataBytes, bytes signature)",
]);
