import { describe, it, expect } from "vitest";
import { redactUnsafePaymentText } from "../src/redaction.js";

describe("redactUnsafePaymentText", () => {
  it("redacts PAYMENT-SIGNATURE header", () => {
    const input =
      "PAYMENT-SIGNATURE: eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGVzdA";
    const result = redactUnsafePaymentText(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("eyJhbGciOiJFUzI1NiJ9");
  });

  it("redacts x-payment header", () => {
    const input =
      "x-payment: eyJhbGciOiJFUzI1NiJ9eyJzdWIiOiIxMjM0NTY3ODkwIn0dGVzdA";
    const result = redactUnsafePaymentText(input);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("eyJhbGciOiJFUzI1NiJ9");
  });

  it("redacts base64 JSON-like payloads (eyJ prefix)", () => {
    const input = "some data eyJhbGciOiJFUzI1NiJ9eyJzdWIiOiIxMjM0NTY3ODkwIn0 end";
    const result = redactUnsafePaymentText(input);
    expect(result).toContain("[REDACTED_B64]");
    expect(result).not.toContain("eyJhbGciOiJFUzI1NiJ9");
  });

  it("redacts long hex strings (>128 chars)", () => {
    const longHex = "0x" + "ab".repeat(100); // 200 hex chars
    const input = `tx data: ${longHex} done`;
    const result = redactUnsafePaymentText(input);
    expect(result).toContain("[REDACTED_HEX]");
    expect(result).not.toContain(longHex);
  });

  it("preserves normal tx hashes (66 chars)", () => {
    const hash = "0x" + "a".repeat(64);
    const input = `tx: ${hash}`;
    const result = redactUnsafePaymentText(input);
    expect(result).toContain(hash);
    expect(result).not.toContain("[REDACTED_HEX]");
  });

  it("handles empty string", () => {
    expect(redactUnsafePaymentText("")).toBe("");
  });

  it("handles text with no sensitive data", () => {
    const input = "hello world, no secrets here";
    expect(redactUnsafePaymentText(input)).toBe(input);
  });

  it("is case-insensitive for headers", () => {
    const input = "payment-signature: eyJhbGciOiJFUzI1NiJ9eyJzdWIiOiIxMjM0NTY3ODkwIn0dGVzdA";
    const result = redactUnsafePaymentText(input);
    expect(result).toContain("[REDACTED]");
  });
});
