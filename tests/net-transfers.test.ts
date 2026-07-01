import { describe, it, expect } from "vitest";
import {
  inferNetTransfers,
  buyerInBatch,
  sellerInBatch,
} from "../src/net-transfers.js";
import { formatSignedUsdc } from "../src/format.js";
import type { BatchEntry } from "../src/types.js";

function entry(
  addr: string,
  delta: bigint,
): BatchEntry {
  return { address: addr as `0x${string}`, delta, usdc: formatSignedUsdc(delta) };
}

describe("inferNetTransfers", () => {
  it("pairs [-100, +100] => 1 transfer", () => {
    const entries = [
      entry("0x0000000000000000000000000000000000000001", BigInt(-100000000)),
      entry("0x0000000000000000000000000000000000000002", BigInt(100000000)),
    ];
    const transfers = inferNetTransfers(entries);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]!.from).toBe(
      "0x0000000000000000000000000000000000000001",
    );
    expect(transfers[0]!.to).toBe(
      "0x0000000000000000000000000000000000000002",
    );
    expect(transfers[0]!.usdc).toBe("100.000000");
  });

  it("[-100, +50, +50] => 0 exact transfers (no single +100)", () => {
    const entries = [
      entry("0x0000000000000000000000000000000000000001", BigInt(-100000000)),
      entry("0x0000000000000000000000000000000000000002", BigInt(50000000)),
      entry("0x0000000000000000000000000000000000000003", BigInt(50000000)),
    ];
    const transfers = inferNetTransfers(entries);
    expect(transfers).toHaveLength(0);
  });

  it("pairs multiple exact opposites", () => {
    const entries = [
      entry("0x0000000000000000000000000000000000000001", BigInt(-100000000)),
      entry("0x0000000000000000000000000000000000000002", BigInt(100000000)),
      entry("0x0000000000000000000000000000000000000003", BigInt(-200000000)),
      entry("0x0000000000000000000000000000000000000004", BigInt(200000000)),
    ];
    const transfers = inferNetTransfers(entries);
    expect(transfers).toHaveLength(2);
  });

  it("handles empty entries", () => {
    expect(inferNetTransfers([])).toHaveLength(0);
  });

  it("ignores zero-delta entries", () => {
    const entries = [
      entry("0x0000000000000000000000000000000000000001", BigInt(0)),
    ];
    expect(inferNetTransfers(entries)).toHaveLength(0);
  });
});

describe("buyerInBatch", () => {
  const entries: BatchEntry[] = [
    entry("0x0000000000000000000000000000000000000001", BigInt(-100000000)),
    entry("0x0000000000000000000000000000000000000002", BigInt(100000000)),
  ];

  it("finds buyer with negative delta", () => {
    const r = buyerInBatch(entries, "0x0000000000000000000000000000000000000001");
    expect(r.found).toBe(true);
    expect(r.entry!.delta).toBe(BigInt(-100000000));
  });

  it("rejects buyer with positive delta", () => {
    const r = buyerInBatch(entries, "0x0000000000000000000000000000000000000002");
    expect(r.found).toBe(false);
  });

  it("rejects address not in entries", () => {
    const r = buyerInBatch(entries, "0x0000000000000000000000000000000000000099");
    expect(r.found).toBe(false);
  });

  it("is case-insensitive", () => {
    const r = buyerInBatch(
      entries,
      "0x0000000000000000000000000000000000000001".toUpperCase(),
    );
    expect(r.found).toBe(true);
  });

  it("accepts DecodedBatch object", () => {
    const decoded = {
      txHash: "0x" as `0x${string}`,
      blockNumber: BigInt(0),
      blockTimestamp: 0,
      relayer: "0x" as `0x${string}`,
      contract: "0x" as `0x${string}`,
      batchId: "0x" as `0x${string}`,
      domain: 26,
      token: "0x" as `0x${string}`,
      innerContract: "0x" as `0x${string}`,
      entries,
      netTransfers: [],
    };
    const r = buyerInBatch(decoded, "0x0000000000000000000000000000000000000001");
    expect(r.found).toBe(true);
  });
});

describe("sellerInBatch", () => {
  const entries: BatchEntry[] = [
    entry("0x0000000000000000000000000000000000000001", BigInt(-100000000)),
    entry("0x0000000000000000000000000000000000000002", BigInt(100000000)),
  ];

  it("finds seller with positive delta", () => {
    const r = sellerInBatch(
      entries,
      "0x0000000000000000000000000000000000000002",
    );
    expect(r.found).toBe(true);
    expect(r.entry!.delta).toBe(BigInt(100000000));
  });

  it("rejects seller with negative delta", () => {
    const r = sellerInBatch(
      entries,
      "0x0000000000000000000000000000000000000001",
    );
    expect(r.found).toBe(false);
  });
});
