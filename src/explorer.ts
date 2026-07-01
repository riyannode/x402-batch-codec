/**
 * Explorer URL helpers — safe URL construction with allowlist validation.
 */

import { isEvmTxHash } from "./guards.js";

const DEFAULT_ALLOWED_HOSTS = new Set([
  "testnet.arcscan.app",
  "arc-testnet.blockscout.com",
  "arcscan.app",
  "arc.blockscout.com",
]);

const DEFAULT_EXPLORER_BASE = "https://testnet.arcscan.app";

/**
 * Build a canonical Arc explorer tx URL.
 * Returns null if the hash is not a valid EVM tx hash.
 */
export function buildArcExplorerTxUrl(
  txHash: unknown,
  explorerBase?: string,
): string | null {
  if (!isEvmTxHash(txHash)) return null;
  const base = (explorerBase ?? DEFAULT_EXPLORER_BASE).replace(/\/+$/, "");
  return `${base}/tx/${txHash}`;
}

/**
 * Validate an explorer URL against an allowlist of hosts.
 * Returns the URL string if valid, null otherwise.
 *
 * Rejects non-http(s) schemes, missing /tx/ path, and non-allowlisted hosts.
 */
export function safeExplorerUrl(
  value: unknown,
  allowedHosts?: Set<string>,
): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    const hosts = allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
    if (!hosts.has(url.hostname)) return null;
    if (!url.pathname.includes("/tx/")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Scan Arc explorer pages for the nearest submitBatch tx whose timestamp
 * is >= the given updatedAtMs (batch is submitted AFTER settlement.completed).
 *
 * This is CANDIDATE DISCOVERY only — timestamp proximity is not proof of inclusion.
 * Callers must verify buyer/seller via decoded delta evidence.
 */
export async function findNearestSubmitBatch(
  explorerBase: string,
  gatewayWallet: string,
  updatedAtMs: number,
  maxPages: number = 10,
): Promise<string | null> {
  let nextPage: Record<string, string> | null = null;
  let bestHash: string | null = null;
  let bestTimestamp = Infinity;

  for (let page = 0; page < maxPages; page++) {
    let url: string;
    if (nextPage) {
      const qs = new URLSearchParams(nextPage).toString();
      url = `${explorerBase}/api/v2/addresses/${gatewayWallet}/transactions?${qs}`;
    } else {
      url = `${explorerBase}/api/v2/addresses/${gatewayWallet}/transactions`;
    }

    let resp: Response;
    try {
      resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    } catch {
      break;
    }
    if (!resp.ok) break;

    const data = (await resp.json()) as {
      items: { hash: string; timestamp: string; method: string | null }[];
      next_page_params: Record<string, string> | null;
    };

    for (const tx of data.items) {
      if (tx.method === "submitBatch" && isEvmTxHash(tx.hash)) {
        const txMs = new Date(tx.timestamp).getTime();
        if (txMs >= updatedAtMs && txMs < bestTimestamp) {
          bestHash = tx.hash;
          bestTimestamp = txMs;
        }
      }
    }

    // If we found something on this page, stop (earliest match wins)
    if (bestHash) break;
    nextPage = data.next_page_params;
    if (!nextPage) break;
  }

  return bestHash;
}
