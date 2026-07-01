/**
 * Formatting helpers for USDC amounts.
 *
 * USDC has 6 decimals. We use BigInt arithmetic to avoid floating-point issues.
 */

/**
 * Format a signed bigint delta as human-readable USDC string.
 * Examples: BigInt(1000000) => "1.000000", BigInt(-500000) => "-0.500000", BigInt(0) => "0.000000"
 */
export function formatSignedUsdc(delta: bigint): string {
  const sign = delta < BigInt(0) ? "-" : "";
  const abs = delta < BigInt(0) ? -delta : delta;
  const whole = abs / BigInt(1000000);
  const frac = (abs % BigInt(1000000)).toString().padStart(6, "0");
  return `${sign}${whole}.${frac}`;
}
