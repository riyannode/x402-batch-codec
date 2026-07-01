/**
 * Guard functions — type-safe validators for common x402 identifiers.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVM_TX_RE = /^0x[a-fA-F0-9]{64}$/;

/** Check if value is a valid EVM transaction hash (0x + 64 hex chars). */
export function isEvmTxHash(value: unknown): value is string {
  return typeof value === "string" && EVM_TX_RE.test(value);
}

/** Check if value is a valid UUID v1-v5. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Alias for isUuid — settlement IDs are UUIDs. */
export function isSettlementId(value: unknown): value is string {
  return isUuid(value);
}
