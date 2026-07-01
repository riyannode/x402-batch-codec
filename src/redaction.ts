/**
 * Redaction helpers — strip sensitive payment data from text.
 *
 * Removes:
 *   - PAYMENT-SIGNATURE header values
 *   - x-payment header values
 *   - Base64 JSON-like payloads (often EIP-712 signed data)
 *   - EIP-712 typed data fragments
 */

/**
 * Remove sensitive payment-related tokens from text.
 *
 * This is a best-effort redaction for log/display use.
 * It is NOT a security boundary — use proper secret handling upstream.
 */
export function redactUnsafePaymentText(text: string): string {
  let out = text;

  // PAYMENT-SIGNATURE: ... (case-insensitive)
  out = out.replace(
    /PAYMENT-SIGNATURE\s*[:=]\s*[A-Za-z0-9+/=_\-]{20,}/gi,
    "PAYMENT-SIGNATURE: [REDACTED]",
  );

  // x-payment: ... (case-insensitive)
  out = out.replace(
    /x-payment\s*[:=]\s*[A-Za-z0-9+/=_\-]{20,}/gi,
    "x-payment: [REDACTED]",
  );

  // Base64-like JSON payloads (eyJ... pattern — base64 of '{"')
  // These are often EIP-712 signed payloads encoded as base64
  out = out.replace(
    /\beyJ[A-Za-z0-9+/]{20,}={0,2}\b/g,
    "[REDACTED_B64]",
  );

  // 0x-prefixed hex strings > 128 chars (likely signed payloads, not tx hashes)
  // Tx hashes are 66 chars (0x + 64 hex). Signed payloads are much longer.
  out = out.replace(
    /\b0x[a-fA-F0-9]{128,}\b/g,
    "[REDACTED_HEX]",
  );

  return out;
}
