import { describe, it, expect } from "vitest";
import { safeExplorerUrl, buildArcExplorerTxUrl } from "../src/explorer.js";

describe("buildArcExplorerTxUrl", () => {
  it("builds URL for valid tx hash", () => {
    const hash = "0x" + "a".repeat(64);
    expect(buildArcExplorerTxUrl(hash)).toBe(
      `https://testnet.arcscan.app/tx/${hash}`,
    );
  });
  it("accepts custom explorer base", () => {
    const hash = "0x" + "a".repeat(64);
    expect(buildArcExplorerTxUrl(hash, "https://arcscan.app")).toBe(
      `https://arcscan.app/tx/${hash}`,
    );
  });
  it("returns null for invalid hash", () => {
    expect(buildArcExplorerTxUrl("0x123")).toBeNull();
  });
  it("returns null for non-string", () => {
    expect(buildArcExplorerTxUrl(null)).toBeNull();
  });
  it("strips trailing slash from base", () => {
    const hash = "0x" + "a".repeat(64);
    expect(buildArcExplorerTxUrl(hash, "https://arcscan.app/")).toBe(
      `https://arcscan.app/tx/${hash}`,
    );
  });
});

describe("safeExplorerUrl", () => {
  it("accepts allowlisted host with /tx/ path", () => {
    const url = "https://testnet.arcscan.app/tx/0x" + "a".repeat(64);
    expect(safeExplorerUrl(url)).toBe(url);
  });
  it("rejects non-allowlisted host", () => {
    expect(
      safeExplorerUrl("https://evil.com/tx/0x" + "a".repeat(64)),
    ).toBeNull();
  });
  it("rejects URL without /tx/ path", () => {
    expect(safeExplorerUrl("https://testnet.arcscan.app/address/0x123")).toBeNull();
  });
  it("rejects non-http scheme", () => {
    expect(safeExplorerUrl("javascript:alert(1)")).toBeNull();
  });
  it("rejects non-string", () => {
    expect(safeExplorerUrl(null)).toBeNull();
    expect(safeExplorerUrl(42)).toBeNull();
  });
  it("rejects empty string", () => {
    expect(safeExplorerUrl("")).toBeNull();
    expect(safeExplorerUrl("   ")).toBeNull();
  });
  it("accepts custom allowlist", () => {
    const hosts = new Set(["custom.explorer.io"]);
    expect(
      safeExplorerUrl("https://custom.explorer.io/tx/0x" + "a".repeat(64), hosts),
    ).not.toBeNull();
    expect(
      safeExplorerUrl("https://testnet.arcscan.app/tx/0x" + "a".repeat(64), hosts),
    ).toBeNull();
  });
});
