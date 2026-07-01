/**
 * Decode a submitBatch on-chain transaction.
 *
 * Two layers:
 *   1. decodeSubmitBatchInput — decode the outer tx.input (submitBatch ABI)
 *   2. decodeBatchTx — fetch tx from chain, decode, enrich with block metadata
 *   3. decodeBatchTxWithRpc — convenience wrapper that creates a PublicClient
 */

import {
  createPublicClient,
  http,
  decodeFunctionData,
  type Hex,
  type PublicClient,
} from "viem";
import { SUBMIT_BATCH_ABI } from "./abi.js";
import { decodeSubmitBatchCalldataBytes } from "./decode-submit-batch.js";
import { inferNetTransfers } from "./net-transfers.js";
import type {
  DecodedBatch,
  DecodedBatchCalldata,
  DecodedSubmitBatchInput,
} from "./types.js";

/**
 * Decode the outer submitBatch(bytes calldataBytes, bytes signature) input data.
 * Returns the raw calldataBytes and signature hex strings.
 * Returns null if the input is not a valid submitBatch call.
 */
export function decodeSubmitBatchInput(
  txInput: `0x${string}`,
): DecodedSubmitBatchInput | null {
  try {
    const decoded = decodeFunctionData({
      abi: SUBMIT_BATCH_ABI,
      data: txInput,
    });
    if (decoded.functionName !== "submitBatch") return null;
    const [calldataBytes, signature] = decoded.args as [
      `0x${string}`,
      `0x${string}`,
    ];
    return { calldataBytes, signature };
  } catch {
    return null;
  }
}

/**
 * Fetch a tx by hash, decode its submitBatch calldata, and enrich with block metadata.
 * Returns null if the tx is not a valid submitBatch or decoding fails.
 *
 * @param txHash - The on-chain tx hash
 * @param client - A viem PublicClient (caller controls RPC endpoint)
 */
export async function decodeBatchTx(
  txHash: string,
  client: PublicClient,
): Promise<DecodedBatch | null> {
  try {
    const tx = await client.getTransaction({
      hash: txHash as `0x${string}`,
    });
    if (!tx.to) return null;

    const outer = decodeSubmitBatchInput(tx.input);
    if (!outer) return null;

    const inner = decodeSubmitBatchCalldataBytes(outer.calldataBytes);
    if (!inner) return null;

    const blockNumber = tx.blockNumber ?? BigInt(0);
    const block = await client.getBlock({ blockNumber });
    const blockTimestamp = Number(block.timestamp);

    const netTransfers = inferNetTransfers(inner.entries);

    return {
      txHash: txHash as `0x${string}`,
      blockNumber,
      blockTimestamp,
      relayer: tx.from,
      contract: tx.to,
      batchId: inner.batchId,
      domain: inner.domain,
      token: inner.token,
      innerContract: inner.innerContract,
      entries: inner.entries,
      netTransfers,
    };
  } catch {
    return null;
  }
}

/**
 * Convenience wrapper: creates a PublicClient from an RPC URL, then calls decodeBatchTx.
 */
export async function decodeBatchTxWithRpc(
  txHash: string,
  rpcUrl: string,
): Promise<DecodedBatch | null> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return decodeBatchTx(txHash, client);
}
