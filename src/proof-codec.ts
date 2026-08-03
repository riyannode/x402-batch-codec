/**
 * Portable batch evidence metadata codec — base64url JSON, unsigned.
 *
 * The encoded object is not a cryptographic proof, attestation, signature,
 * or smart-contract verification result.
 */

import { isBytes32, isEvmAddress, isEvmTxHash } from "./guards.js";
import { safeExplorerUrl } from "./explorer.js";
import type { MatchedBy, VerificationLevel, X402BatchProof } from "./types.js";

const UNSAFE_KEYS = new Set([
  "signature",
  "paymentsignature",
  "xpayment",
  "paymentheader",
  "eip712",
  "typeddata",
  "entitysecret",
  "entitysecretciphertext",
  "privatekey",
  "apikey",
  "authorization",
  "walletid",
]);

const VERIFICATION_LEVELS = new Set<VerificationLevel>([
  "unresolved",
  "timestamp_candidate",
  "decoded_batch",
  "address_participation",
]);
const MATCHED_BY = new Set<MatchedBy>([
  "gateway_txhash_field",
  "timestamp_candidate",
  "decoded_delta",
  "manual_tx",
]);
const ALLOWED_KEYS = new Set([
  "v",
  "settlementId",
  "gatewayStatus",
  "status",
  "verificationLevel",
  "matchedBy",
  "txHash",
  "explorerUrl",
  "batchId",
  "domain",
  "token",
  "gatewayWallet",
  "entriesCount",
  "netTransfersCount",
  "buyerVerified",
  "sellerVerified",
  "buyerEntry",
  "sellerEntry",
  "limitations",
]);

function findUnsafeKey(value: unknown, path = ""): string | null {
  if (value === null) return null;
  if (typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findUnsafeKey(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return "unsupported_object";
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (UNSAFE_KEYS.has(key.toLowerCase())) {
      return path ? `${path}.${key}` : key;
    }
    const found = findUnsafeKey(obj[key], path ? `${path}.${key}` : key);
    if (found) return found;
  }
  return null;
}

function validateJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) return value.every(validateJsonValue);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value as Record<string, unknown>).every(validateJsonValue);
}

function validNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validEntry(value: unknown): value is { address: `0x${string}`; usdc: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return (
    Object.keys(obj).every((key) => key === "address" || key === "usdc") &&
    isEvmAddress(obj["address"]) &&
    typeof obj["usdc"] === "string" &&
    obj["usdc"].length > 0
  );
}

function validateProof(value: unknown): value is X402BatchProof {
  if (!validateJsonValue(value)) return false;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if (![...Object.keys(obj)].every((key) => ALLOWED_KEYS.has(key))) return false;
  if (obj["v"] !== 1 || !VERIFICATION_LEVELS.has(obj["verificationLevel"] as VerificationLevel)) {
    return false;
  }
  if (!("txHash" in obj) || !("explorerUrl" in obj)) return false;
  if (obj["txHash"] !== null && !isEvmTxHash(obj["txHash"])) return false;
  if (obj["explorerUrl"] !== null && safeExplorerUrl(obj["explorerUrl"]) === null) return false;
  if (!validNonnegativeInteger(obj["entriesCount"])) return false;
  if (!validNonnegativeInteger(obj["netTransfersCount"])) return false;

  if (obj["settlementId"] !== undefined && typeof obj["settlementId"] !== "string") return false;
  if (obj["gatewayStatus"] !== undefined && typeof obj["gatewayStatus"] !== "string") return false;
  if (obj["status"] !== undefined && typeof obj["status"] !== "string") return false;
  if (obj["matchedBy"] !== undefined && !MATCHED_BY.has(obj["matchedBy"] as MatchedBy)) return false;
  if (obj["batchId"] !== undefined && !isBytes32(obj["batchId"])) return false;
  if (obj["domain"] !== undefined && (!validNonnegativeInteger(obj["domain"]) || obj["domain"] > 0xffff_ffff)) return false;
  if (obj["token"] !== undefined && !isEvmAddress(obj["token"])) return false;
  if (obj["gatewayWallet"] !== undefined && !isEvmAddress(obj["gatewayWallet"])) return false;
  if (obj["buyerVerified"] !== undefined && typeof obj["buyerVerified"] !== "boolean") return false;
  if (obj["sellerVerified"] !== undefined && typeof obj["sellerVerified"] !== "boolean") return false;
  if (obj["buyerEntry"] !== undefined && !validEntry(obj["buyerEntry"])) return false;
  if (obj["sellerEntry"] !== undefined && !validEntry(obj["sellerEntry"])) return false;
  if (
    obj["limitations"] !== undefined &&
    (!Array.isArray(obj["limitations"]) || !obj["limitations"].every((x) => typeof x === "string"))
  ) return false;
  return true;
}

/** Encode portable batch evidence metadata as a strict base64url JSON object. */
export function encodeBatchProof(proof: X402BatchProof): string {
  if (proof?.v !== 1) throw new Error(`Unsupported proof version: ${proof?.v}`);
  const unsafe = findUnsafeKey(proof);
  if (unsafe) throw new Error(`Proof contains unsafe field: ${unsafe}`);
  if (!validateProof(proof)) throw new Error("Invalid portable batch evidence metadata");
  const json = JSON.stringify(proof);
  return Buffer.from(json, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Decode and validate portable batch evidence metadata. */
export function decodeBatchProof(encoded: string): X402BatchProof | null {
  try {
    if (typeof encoded !== "string" || !encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
      return null;
    }
    let b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const json = Buffer.from(b64, "base64").toString("utf-8");
    const parsed: unknown = JSON.parse(json);
    if (findUnsafeKey(parsed)) return null;
    return validateProof(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
