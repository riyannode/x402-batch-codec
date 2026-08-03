/**
 * Decode the inner calldataBytes of a submitBatch tx.
 *
 * Layout (per on-chain inspection):
 *   word 0: dynamic offset pointer (typically 0xa0)
 *   word 1: batchId (bytes32)
 *   word 2: gateway domain (uint32) — 26 = Arc
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

const WORD_HEX_LENGTH = 64;
const HEADER_WORDS = 6;
const DEFAULT_MAX_ENTRIES = 10_000;
const UINT32_MAX = 0xffff_ffffn;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const HEX_RE = /^[0-9a-fA-F]*$/;

export type DecodeSubmitBatchOptions = {
  maxEntries?: number;
};

function wordAt(calldata: string, index: number): string | null {
  const start = index * WORD_HEX_LENGTH;
  const end = start + WORD_HEX_LENGTH;
  if (start < 0 || end > calldata.length) return null;
  return calldata.slice(start, end);
}

function parseWord(word: string | null): bigint | null {
  if (!word || word.length !== WORD_HEX_LENGTH || !HEX_RE.test(word)) return null;
  try {
    return BigInt(`0x${word}`);
  } catch {
    return null;
  }
}

function addressFromWord(word: string | null): `0x${string}` | null {
  if (!word || word.length !== WORD_HEX_LENGTH || !HEX_RE.test(word)) return null;
  // ABI address words must be left-padded with zeroes.
  if (!/^0{24}/i.test(word)) return null;
  try {
    return getAddress(`0x${word.slice(24)}` as `0x${string}`);
  } catch {
    return null;
  }
}

/**
 * Decode the inner calldataBytes (the first arg of submitBatch).
 * Returns null if the calldata is malformed, unsafe, or too short.
 */
export function decodeSubmitBatchCalldataBytes(
  calldataBytes: `0x${string}`,
  options: DecodeSubmitBatchOptions = {},
): DecodedBatchCalldata | null {
  try {
    if (typeof calldataBytes !== "string" || !calldataBytes.startsWith("0x")) {
      return null;
    }

    const calldata = calldataBytes.slice(2);
    if (calldata.length % 2 !== 0 || !HEX_RE.test(calldata)) return null;
    if (calldata.length < HEADER_WORDS * WORD_HEX_LENGTH) return null;

    const totalBytes = calldata.length / 2;
    const offset = parseWord(wordAt(calldata, 0));
    // The current inner layout has five fixed words before the entry payload.
    // Keep the check bounded and explicit without converting an arbitrary word
    // to a JavaScript number.
    if (
      offset === null ||
      offset < 5n * 32n ||
      offset > BigInt(totalBytes) ||
      offset > MAX_SAFE_BIGINT
    ) {
      return null;
    }

    const batchIdWord = wordAt(calldata, 1);
    if (!batchIdWord || !HEX_RE.test(batchIdWord)) return null;
    const batchId = `0x${batchIdWord}` as `0x${string}`;

    const domainWord = parseWord(wordAt(calldata, 2));
    if (domainWord === null || domainWord > UINT32_MAX) return null;
    const domain = Number(domainWord);

    const token = addressFromWord(wordAt(calldata, 3));
    const innerContract = addressFromWord(wordAt(calldata, 4));
    if (!token || !innerContract) return null;

    const countWord = parseWord(wordAt(calldata, 5));
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) return null;
    if (
      countWord === null ||
      countWord > BigInt(maxEntries) ||
      countWord > MAX_SAFE_BIGINT
    ) {
      return null;
    }
    const count = Number(countWord);

    const requiredWords = BigInt(HEADER_WORDS) + BigInt(count) * 2n;
    if (requiredWords * BigInt(WORD_HEX_LENGTH) > BigInt(calldata.length)) {
      return null;
    }

    const entries: BatchEntry[] = [];
    for (let i = 0; i < count; i++) {
      const address = addressFromWord(wordAt(calldata, HEADER_WORDS + i * 2));
      const deltaWord = wordAt(calldata, HEADER_WORDS + i * 2 + 1);
      if (!address || !deltaWord || !HEX_RE.test(deltaWord)) return null;
      let delta: bigint;
      try {
        delta = hexToBigInt(`0x${deltaWord}` as Hex, { signed: true });
      } catch {
        return null;
      }
      entries.push({ address, delta, usdc: formatSignedUsdc(delta) });
    }

    return { batchId, domain, token, innerContract, entries };
  } catch {
    return null;
  }
}
