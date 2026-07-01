/**
 * Proof codec — encode/decode safe X402BatchProof objects as base64url JSON.
 *
 * Security rules:
 *   - Recursively rejects any object containing unsafe field names.
 *   - Unsafe keys: signature, paymentSignature, xPayment, paymentHeader,
 *     eip712, typedData, entitySecret, entitySecretCiphertext,
 *     privateKey, apiKey, authorization, walletId
 *   - Never encodes raw payment signatures, EIP-712 payloads, or x402 headers.
 */

import type { X402BatchProof } from "./types.js";

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

/**
 * Recursively scan an object for unsafe field names.
 * Returns the first unsafe key found, or null if clean.
 */
function findUnsafeKey(value: unknown, path: string = ""): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return null;

  // Handle arrays
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findUnsafeKey(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }

  // Handle plain objects
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

/**
 * Encode an X402BatchProof as a base64url JSON string.
 *
 * Throws if the proof contains any unsafe field names (recursive check).
 * The proof must have `v: 1` set.
 */
export function encodeBatchProof(proof: X402BatchProof): string {
  if (proof.v !== 1) {
    throw new Error(`Unsupported proof version: ${proof.v}`);
  }
  const unsafe = findUnsafeKey(proof);
  if (unsafe) {
    throw new Error(`Proof contains unsafe field: ${unsafe}`);
  }
  const json = JSON.stringify(proof);
  // base64url: replace +/= with URL-safe chars
  const b64 = Buffer.from(json, "utf-8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode a base64url JSON string back to an X402BatchProof.
 *
 * Validates schema: must have `v: 1`, required fields present.
 * Rejects encoded payloads containing unsafe field names.
 * Returns null if decoding or validation fails.
 */
export function decodeBatchProof(encoded: string): X402BatchProof | null {
  try {
    // Restore standard base64
    let b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    // Pad to multiple of 4
    while (b64.length % 4 !== 0) b64 += "=";

    const json = Buffer.from(b64, "base64").toString("utf-8");
    const parsed = JSON.parse(json) as unknown;

    if (typeof parsed !== "object" || parsed === null) return null;

    const obj = parsed as Record<string, unknown>;

    // Version check
    if (obj["v"] !== 1) return null;

    // Required fields
    if (typeof obj["entriesCount"] !== "number") return null;
    if (typeof obj["netTransfersCount"] !== "number") return null;

    // txHash can be null or a string
    if (obj["txHash"] !== null && typeof obj["txHash"] !== "string")
      return null;

    // Recursive unsafe key check
    const unsafe = findUnsafeKey(obj);
    if (unsafe) return null;

    return obj as unknown as X402BatchProof;
  } catch {
    return null;
  }
}
