/**
 * Net transfer inference and buyer/seller lookup from batch entries.
 *
 * Pure functions — no RPC, no viem client, no side effects.
 */

import type { BatchEntry, DecodedBatch, NetTransfer } from "./types.js";
import { formatSignedUsdc } from "./format.js";

/**
 * Infer net transfers by pairing each negative delta with an exact-opposite positive.
 *
 * Only exact matches produce a NetTransfer. Leftover unmatched entries are ignored.
 * This is NOT a full netting algorithm — it's deliberate:
 *   [-100, +100] => 1 transfer
 *   [-100, +50, +50] => 0 exact transfers (no single +100 to pair with)
 *
 * Rationale: exact matching avoids false positives from multi-hop or fee splits.
 */
export function inferNetTransfers(entries: BatchEntry[]): NetTransfer[] {
  const negatives: BatchEntry[] = entries.filter((e) => e.delta < BigInt(0));
  const positives: BatchEntry[] = entries.filter((e) => e.delta > BigInt(0));

  // Track which positive indices have been consumed
  const used = new Set<number>();
  const transfers: NetTransfer[] = [];

  for (const n of negatives) {
    for (let j = 0; j < positives.length; j++) {
      if (used.has(j)) continue;
      // Exact opposite match
      if (positives[j]!.delta === -n.delta) {
        used.add(j);
        transfers.push({
          from: n.address,
          to: positives[j]!.address,
          usdc: formatSignedUsdc(-n.delta),
        });
        break;
      }
    }
  }

  return transfers;
}

/**
 * Check if a buyer address appears in entries with a negative delta (paid into batch).
 * Accepts either a DecodedBatch or a raw BatchEntry[].
 */
export function buyerInBatch(
  decodedOrEntries: DecodedBatch | BatchEntry[],
  buyerAddress: string,
): { found: boolean; entry?: BatchEntry } {
  const entries: BatchEntry[] = Array.isArray(decodedOrEntries)
    ? decodedOrEntries
    : decodedOrEntries.entries;
  const normalized = buyerAddress.toLowerCase();
  for (const entry of entries) {
    if (entry.address.toLowerCase() === normalized && entry.delta < BigInt(0)) {
      return { found: true, entry };
    }
  }
  return { found: false };
}

/**
 * Check if a seller/recipient address appears in entries with a positive delta (received from batch).
 * Accepts either a DecodedBatch or a raw BatchEntry[].
 */
export function sellerInBatch(
  decodedOrEntries: DecodedBatch | BatchEntry[],
  sellerAddress: string,
): { found: boolean; entry?: BatchEntry } {
  const entries: BatchEntry[] = Array.isArray(decodedOrEntries)
    ? decodedOrEntries
    : decodedOrEntries.entries;
  const normalized = sellerAddress.toLowerCase();
  for (const entry of entries) {
    if (entry.address.toLowerCase() === normalized && entry.delta > BigInt(0)) {
      return { found: true, entry };
    }
  }
  return { found: false };
}
