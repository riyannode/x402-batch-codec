/**
 * Decode the inner calldataBytes of a submitBatch tx.
 *
 * Layout (per on-chain inspection):
 *   word 0: offset pointer to entries (typically 0xa0 = 160)
 *   word 1: batchId (bytes32)
 *   word 2: gateway domain (uint32, last byte populated) — 26 = Arc
 *   word 3: token address
 *   word 4: gateway-wallet contract address
 *   word 5: entries length
 *   words 6+: (address, int256 delta) pairs
 *
 * Pure function — no RPC, no side effects.
 */

import { hexToBigInt, getAddress, type Hex } from "viem";
import type { BatchEntry, DecodedBatchCalldata } from "./types.js";
import { formatSignedUsdc } from "./format.js";

/**
 * Decode the inner calldataBytes (the first arg of submitBatch).
 * Returns null if the calldata is malformed or too short.
 */
export function decodeSubmitBatchCalldataBytes(
  calldataBytes: `0x${string}`,
): DecodedBatchCalldata | null {
  try {
    const calldata = calldataBytes.slice(2);
    // Minimum: 6 header words + 1 entry (2 words) = 8 * 64 = 512 hex chars
    if (calldata.length < 512) return null;

    const word = (i: number) => calldata.slice(i * 64, (i + 1) * 64);
    const addrFromWord = (i: number) =>
      getAddress(("0x" + word(i)!.slice(24)) as `0x${string}`);
    const intFromWord = (i: number, signed = false) =>
      hexToBigInt(("0x" + word(i)!) as Hex, { signed });

    // word 0: offset pointer (skip — typically 0xa0)
    // word 1: batchId
    const batchId = ("0x" + word(1)!) as Hex;
    // word 2: domain
    const domain = Number(intFromWord(2));
    // word 3: token
    const token = addrFromWord(3);
    // word 4: inner contract / gateway wallet
    const innerContract = addrFromWord(4);
    // word 5: entries count
    const count = Number(intFromWord(5));
    if (count < 0 || count > 10000) return null;

    // Check we have enough words for all entries
    const requiredHexChars = (6 + count * 2) * 64;
    if (calldata.length < requiredHexChars) return null;

    // words 6+: (address, int256 delta) pairs
    const entries: BatchEntry[] = [];
    for (let i = 0; i < count; i++) {
      const address = addrFromWord(6 + i * 2);
      const delta = intFromWord(7 + i * 2, true); // signed
      entries.push({ address, delta, usdc: formatSignedUsdc(delta) });
    }

    return { batchId, domain, token, innerContract, entries };
  } catch {
    return null;
  }
}
