import { describe, it, expect } from "vitest";
import { isEvmTxHash, isUuid, isSettlementId } from "../src/guards.js";

describe("isEvmTxHash", () => {
  it("accepts valid 0x + 64 hex", () => {
    expect(isEvmTxHash("0x" + "a".repeat(64))).toBe(true);
  });
  it("accepts mixed case", () => {
    expect(isEvmTxHash("0x" + "AbCdEf0123456789".repeat(4))).toBe(true);
  });
  it("rejects short hash", () => {
    expect(isEvmTxHash("0x123")).toBe(false);
  });
  it("rejects missing 0x prefix", () => {
    expect(isEvmTxHash("a".repeat(64))).toBe(false);
  });
  it("rejects non-string", () => {
    expect(isEvmTxHash(null)).toBe(false);
    expect(isEvmTxHash(42)).toBe(false);
    expect(isEvmTxHash(undefined)).toBe(false);
  });
  it("rejects too-long hash", () => {
    expect(isEvmTxHash("0x" + "a".repeat(65))).toBe(false);
  });
});

describe("isUuid", () => {
  it("accepts valid UUID v4", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });
  it("accepts UUID v1", () => {
    expect(isUuid("c9933054-6b34-44bb-8c04-e7e9e1b8352c")).toBe(true);
  });
  it("rejects non-UUID string", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
  });
  it("rejects empty string", () => {
    expect(isUuid("")).toBe(false);
  });
  it("rejects non-string", () => {
    expect(isUuid(null)).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});

describe("isSettlementId", () => {
  it("is an alias for isUuid", () => {
    expect(isSettlementId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isSettlementId("not-a-uuid")).toBe(false);
  });
});
