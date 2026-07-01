import { describe, it, expect } from "vitest";
import { formatSignedUsdc } from "../src/format.js";

describe("formatSignedUsdc", () => {
  it("formats positive delta", () => {
    expect(formatSignedUsdc(BigInt(1000000))).toBe("1.000000");
  });
  it("formats negative delta", () => {
    expect(formatSignedUsdc(BigInt(-1000000))).toBe("-1.000000");
  });
  it("formats zero", () => {
    expect(formatSignedUsdc(BigInt(0))).toBe("0.000000");
  });
  it("formats fractional", () => {
    expect(formatSignedUsdc(BigInt(500000))).toBe("0.500000");
  });
  it("formats negative fractional", () => {
    expect(formatSignedUsdc(BigInt(-500000))).toBe("-0.500000");
  });
  it("formats small amounts", () => {
    expect(formatSignedUsdc(BigInt(1))).toBe("0.000001");
  });
  it("formats large amounts", () => {
    expect(formatSignedUsdc(BigInt(1000000000))).toBe("1000.000000");
  });
  it("formats negative large", () => {
    expect(formatSignedUsdc(BigInt(-1000000000))).toBe("-1000.000000");
  });
});
