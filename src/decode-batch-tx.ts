/**
 * Decode a submitBatch on-chain transaction.
 *
 * The strict resolver path validates mining, receipt success, Gateway wallet,
 * domain, and token context before exposing decoded batch evidence.
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
  DecodedSubmitBatchInput,
  DecodeBatchTxOptions,
} from "./types.js";

/**
 * Decode the outer submitBatch(bytes calldataBytes, bytes signature) input.
 * Returns signature metadata only; raw signature bytes are never returned.
 */
export function decodeSubmitBatchInput(
  txInput: `0x${string}`,
): DecodedSubmitBatchInput | null {
  try {
    if (
      typeof txInput !== "string" ||
      !txInput.startsWith("0x") ||
      (txInput.length - 2) % 2 !== 0 ||
      !/^0x[0-9a-fA-F]*$/.test(txInput)
    ) {
      return null;
    }
    const decoded = decodeFunctionData({
      abi: SUBMIT_BATCH_ABI,
      data: txInput,
    });
    if (decoded.functionName !== "submitBatch") return null;
    const [calldataBytes, signature] = decoded.args as [
      `0x${string}`,
      `0x${string}`,
    ];
    return {
      calldataBytes,
      hasSignature: signature !== "0x",
      signatureBytesLength: Math.max(0, (signature.length - 2) / 2),
    };
  } catch {
    return null;
  }
}

function addressMatches(actual: string, expected?: string): boolean {
  return !expected || actual.toLowerCase() === expected.toLowerCase();
}

/**
 * Fetch a tx, validate its optional strict context, decode submitBatch, and
 * enrich with block metadata. Returns null on any validation or decode failure.
 */
export async function decodeBatchTx(
  txHash: string,
  client: PublicClient,
  options: DecodeBatchTxOptions = {},
): Promise<DecodedBatch | null> {
  try {
    const strict =
      options.requireReceipt === true ||
      options.expectedGatewayWallet !== undefined ||
      options.expectedDomain !== undefined ||
      options.expectedToken !== undefined;

    const tx = await client.getTransaction({
      hash: txHash as `0x${string}`,
    });
    if (!tx.to || tx.blockNumber === null || tx.blockNumber === undefined) {
      return null;
    }
    if (tx.blockNumber <= 0n) return null;
    if (
      options.expectedGatewayWallet &&
      !addressMatches(tx.to, options.expectedGatewayWallet)
    ) {
      return null;
    }

    if (strict) {
      const receipt = await client.getTransactionReceipt({
        hash: txHash as `0x${string}`,
      });
      if (!receipt || receipt.status !== "success") return null;
    }

    const outer = decodeSubmitBatchInput(tx.input);
    if (!outer) return null;

    const inner = decodeSubmitBatchCalldataBytes(outer.calldataBytes);
    if (!inner) return null;
    if (
      options.expectedGatewayWallet &&
      !addressMatches(inner.innerContract, options.expectedGatewayWallet)
    ) {
      return null;
    }
    if (
      options.expectedDomain !== undefined &&
      inner.domain !== options.expectedDomain
    ) {
      return null;
    }
    if (options.expectedToken && !addressMatches(inner.token, options.expectedToken)) {
      return null;
    }

    const block = await client.getBlock({ blockNumber: tx.blockNumber });
    const blockTimestamp = Number(block.timestamp);
    if (!Number.isSafeInteger(blockTimestamp) || blockTimestamp < 0) return null;

    const netTransfers = inferNetTransfers(inner.entries);

    return {
      txHash: txHash as `0x${string}`,
      blockNumber: tx.blockNumber,
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

/** Convenience wrapper around decodeBatchTx using a caller-supplied RPC URL. */
export async function decodeBatchTxWithRpc(
  txHash: string,
  rpcUrl: string,
  options: DecodeBatchTxOptions = {},
): Promise<DecodedBatch | null> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return decodeBatchTx(txHash, client, options);
}
