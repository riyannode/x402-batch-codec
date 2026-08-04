/**
 * Explorer URL helpers and explicitly legacy timestamp-only submitBatch
 * candidate discovery. Candidate discovery is heuristic and is not an
 * official Circle transfer mapping.
 */

import { isEvmTxHash } from "./guards.js";

const DEFAULT_ALLOWED_HOSTS = new Set([
  "testnet.arcscan.app",
  "arc-testnet.blockscout.com",
  "arcscan.app",
  "arc.blockscout.com",
]);

const DEFAULT_EXPLORER_BASE = "https://testnet.arcscan.app";
export const DEFAULT_MAX_DISTANCE_MS = 60 * 60 * 1000;

export type SubmitBatchCandidate = {
  txHash: `0x${string}`;
  timestamp: string;
  timestampMs: number;
  distanceMs: number;
};

/** Build an Arc explorer tx URL for a valid transaction hash. */
export function buildArcExplorerTxUrl(
  txHash: unknown,
  explorerBase?: string,
): string | null {
  if (!isEvmTxHash(txHash)) return null;
  const base = (explorerBase ?? DEFAULT_EXPLORER_BASE).replace(/\/+$/, "");
  return `${base}/tx/${txHash}`;
}

/** Validate an explorer URL against an HTTPS host allowlist. */
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Normalize Blockscout's primitive cursor values for URLSearchParams. */
function normalizePageCursor(value: unknown): Record<string, string> | null {
  if (value === null || value === undefined) return null;
  if (!isPlainRecord(value)) return null;

  const normalized: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || item === undefined) continue;
    if (typeof item === "string") {
      normalized[key] = item;
    } else if (typeof item === "number" && Number.isFinite(item)) {
      normalized[key] = String(item);
    } else if (typeof item === "boolean") {
      normalized[key] = String(item);
    } else {
      return null;
    }
  }
  return normalized;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isTransactionItem(value: unknown): value is {
  hash: unknown;
  timestamp: unknown;
  method: unknown;
} {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Scan all explorer pages up to maxPages and return eligible candidates sorted
 * by timestamp distance. This is candidate discovery only; it is not inclusion
 * verification.
 */
export async function findSubmitBatchCandidates(
  explorerBase: string,
  gatewayWallet: string,
  updatedAtMs: number,
  maxPages = 10,
  maxDistanceMs = DEFAULT_MAX_DISTANCE_MS,
): Promise<SubmitBatchCandidate[]> {
  if (
    !Number.isFinite(updatedAtMs) ||
    updatedAtMs < 0 ||
    !Number.isSafeInteger(maxPages) ||
    maxPages <= 0 ||
    !Number.isFinite(maxDistanceMs) ||
    maxDistanceMs < 0
  ) {
    return [];
  }

  let nextPage: Record<string, string> | null = null;
  const candidates = new Map<string, SubmitBatchCandidate>();

  for (let page = 0; page < maxPages; page++) {
    const url = nextPage
      ? `${explorerBase}/api/v2/addresses/${encodeURIComponent(gatewayWallet)}/transactions?${new URLSearchParams(nextPage).toString()}`
      : `${explorerBase}/api/v2/addresses/${encodeURIComponent(gatewayWallet)}/transactions`;

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    } catch {
      break;
    }
    if (!response.ok) break;

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      break;
    }
    if (!isPlainRecord(data) || !Array.isArray(data["items"])) break;

    // Process the current page before validating its cursor. A malformed next
    // cursor must not discard candidates already found on this page.
    for (const item of data["items"]) {
      if (!isTransactionItem(item)) continue;
      if (item.method !== "submitBatch" || !isEvmTxHash(item.hash)) continue;
      const timestampMs = parseTimestamp(item.timestamp);
      if (timestampMs === null || timestampMs < updatedAtMs) continue;
      const distanceMs = timestampMs - updatedAtMs;
      if (distanceMs > maxDistanceMs) continue;
      const candidate: SubmitBatchCandidate = {
        txHash: item.hash,
        timestamp: item.timestamp as string,
        timestampMs,
        distanceMs,
      };
      candidates.set(candidate.txHash.toLowerCase(), candidate);
    }

    const rawPageParams = data["next_page_params"];
    if (rawPageParams === null || rawPageParams === undefined) break;
    const normalizedPageParams = normalizePageCursor(rawPageParams);
    if (!normalizedPageParams || Object.keys(normalizedPageParams).length === 0) break;
    nextPage = normalizedPageParams;
  }

  return [...candidates.values()].sort(
    (a, b) => a.distanceMs - b.distanceMs || a.timestampMs - b.timestampMs,
  );
}

/**
 * Backward-compatible helper returning only the nearest candidate hash.
 * New resolver code should use findSubmitBatchCandidates.
 */
export async function findNearestSubmitBatch(
  explorerBase: string,
  gatewayWallet: string,
  updatedAtMs: number,
  maxPages = 10,
  maxDistanceMs = DEFAULT_MAX_DISTANCE_MS,
): Promise<`0x${string}` | null> {
  const candidates = await findSubmitBatchCandidates(
    explorerBase,
    gatewayWallet,
    updatedAtMs,
    maxPages,
    maxDistanceMs,
  );
  return candidates[0]?.txHash ?? null;
}
