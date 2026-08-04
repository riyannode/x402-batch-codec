import { afterEach, describe, expect, it, vi } from "vitest";
import {
  safeExplorerUrl,
  buildArcExplorerTxUrl,
  findSubmitBatchCandidates,
} from "../src/explorer.js";

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
  it("rejects http (https-only)", () => {
    expect(
      safeExplorerUrl("http://testnet.arcscan.app/tx/0x" + "a".repeat(64)),
    ).toBeNull();
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

describe("Blockscout pagination", () => {
  const updatedAt = Date.parse("2026-01-01T00:00:00.000Z");
  const firstHash = ("0x" + "a".repeat(64)) as `0x${string}`;
  const secondHash = ("0x" + "b".repeat(64)) as `0x${string}`;
  const response = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

  afterEach(() => vi.unstubAllGlobals());

  it("accepts numeric, boolean, and null cursor members and stringifies them", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        items: [{ hash: firstHash, timestamp: "2026-01-01T00:00:01.000Z", method: "submitBatch" }],
        next_page_params: { block_number: 123, index: 4, items_count: 2, descending: true, ignored: null },
      }))
      .mockResolvedValueOnce(response({
        items: [{ hash: secondHash, timestamp: "2026-01-01T00:00:02.000Z", method: "submitBatch" }],
        next_page_params: null,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await findSubmitBatchCandidates("https://testnet.arcscan.app", "0x123", updatedAt, 3);
    expect(candidates.map((item) => item.txHash)).toEqual([firstHash, secondHash]);
    const nextUrl = fetchMock.mock.calls[1]![0] as string;
    expect(new URL(nextUrl).searchParams.get("block_number")).toBe("123");
    expect(new URL(nextUrl).searchParams.get("index")).toBe("4");
    expect(new URL(nextUrl).searchParams.get("items_count")).toBe("2");
    expect(new URL(nextUrl).searchParams.get("descending")).toBe("true");
    expect(new URL(nextUrl).searchParams.has("ignored")).toBe(false);
  });

  it("retains current-page candidates when the next cursor is malformed", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({
      items: [{ hash: firstHash, timestamp: "2026-01-01T00:00:01.000Z", method: "submitBatch" }],
      next_page_params: { nested: { block_number: 123 } },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await findSubmitBatchCandidates("https://testnet.arcscan.app", "0x123", updatedAt);
    expect(candidates.map((item) => item.txHash)).toEqual([firstHash]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a cursor containing only null and undefined as no next page", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({
      items: [{ hash: firstHash, timestamp: "2026-01-01T00:00:01.000Z", method: "submitBatch" }],
      next_page_params: { block_number: null, index: undefined },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await findSubmitBatchCandidates("https://testnet.arcscan.app", "0x123", updatedAt);
    expect(candidates).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "array", cursor: [] },
    { label: "NaN", cursor: { block_number: Number.NaN } },
    { label: "Infinity", cursor: { block_number: Number.POSITIVE_INFINITY } },
    { label: "function", cursor: { block_number: () => 1 } },
  ])("rejects malformed $label cursors without losing current candidates", async ({ cursor }) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({
      items: [{ hash: firstHash, timestamp: "2026-01-01T00:00:01.000Z", method: "submitBatch" }],
      next_page_params: cursor,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(findSubmitBatchCandidates("https://testnet.arcscan.app", "0x123", updatedAt)).resolves.toHaveLength(1);
  });
});
