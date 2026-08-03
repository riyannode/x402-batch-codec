import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, type PublicClient } from "viem";
import { SUBMIT_BATCH_ABI } from "../src/abi.js";
import { resolveX402BatchProof } from "../src/resolver.js";

const SETTLEMENT_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_ID = "550e8400-e29b-41d4-a716-446655440001";
const WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const TOKEN = "0x3600000000000000000000000000000000000000";
const BUYER = "0x0000000000000000000000000000000000000001";
const SELLER = "0x0000000000000000000000000000000000000002";
const WRONG = "0x0000000000000000000000000000000000000003";
const TX_HASH = ("0x" + "a".repeat(64)) as `0x${string}`;
const OTHER_TX_HASH = ("0x" + "b".repeat(64)) as `0x${string}`;
const UPDATED_AT = "2026-01-01T00:00:00.000Z";
const CANDIDATE_TIME = "2026-01-01T00:00:01.000Z";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

function wordFromAddress(address: string): string {
  return "0".repeat(24) + address.slice(2).toLowerCase();
}

function buildInner(options: {
  domain?: number;
  token?: string;
  innerContract?: string;
  offset?: string;
} = {}): `0x${string}` {
  const pad = (value: string) => value.padStart(64, "0");
  const negative = ((1n << 256n) - 1_000_000n).toString(16).padStart(64, "0");
  return (`0x${[
    pad(options.offset ?? "a0"),
    "91".padEnd(64, "0"),
    pad((options.domain ?? 26).toString(16)),
    wordFromAddress(options.token ?? TOKEN),
    wordFromAddress(options.innerContract ?? WALLET),
    pad("2"),
    wordFromAddress(BUYER),
    negative,
    wordFromAddress(SELLER),
    pad("f4240"),
  ].join("")}`) as `0x${string}`;
}

function buildFixture(options: Parameters<typeof buildInner>[0] = {}) {
  const inner = buildInner(options);
  const input = encodeFunctionData({
    abi: SUBMIT_BATCH_ABI,
    args: [inner, "0x"],
  });
  return { inner, input };
}

function rpcClient(options: {
  fixture?: ReturnType<typeof buildFixture>;
  to?: string;
  receiptStatus?: "success" | "reverted";
  throwOnTransaction?: boolean;
  returnedHash?: string;
  blockNumber?: bigint | null;
  calls?: { getTransaction: ReturnType<typeof vi.fn> };
} = {}): PublicClient {
  const calls = options.calls ?? { getTransaction: vi.fn() };
  calls.getTransaction.mockImplementation(async () => {
    if (options.throwOnTransaction) throw new Error("rpc unavailable");
    return {
      hash: (options.returnedHash ?? TX_HASH) as `0x${string}`,
      to: (options.to ?? WALLET) as `0x${string}`,
      from: "0x0000000000000000000000000000000000000099" as `0x${string}`,
      input: (options.fixture ?? buildFixture()).input,
      blockNumber: options.blockNumber === undefined ? 123n : options.blockNumber,
    };
  });
  return {
    getTransaction: calls.getTransaction,
    getTransactionReceipt: vi.fn(async () => ({ status: options.receiptStatus ?? "success" })),
    getBlock: vi.fn(async () => ({ timestamp: 1_767_220_800n })),
  } as unknown as PublicClient;
}

function gatewayBody(
  status: string = "completed",
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id: SETTLEMENT_ID, status, updatedAt: UPDATED_AT, ...extra };
}

function explorerBody(hash = TX_HASH): Record<string, unknown> {
  return {
    items: [{ hash, timestamp: CANDIDATE_TIME, method: "submitBatch" }],
    next_page_params: null,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function resolveOfficial(
  body: Record<string, unknown> = gatewayBody("completed", { txHash: TX_HASH }),
  client: PublicClient = rpcClient(),
  extra: Record<string, unknown> = {},
) {
  fetchMock.mockResolvedValueOnce(jsonResponse(body));
  return resolveX402BatchProof({
    settlementId: SETTLEMENT_ID,
    rpcClient: client,
    ...extra,
  });
}

describe("Circle transfer validation and status gating", () => {
  it("rejects an invalid settlement UUID without fetching Gateway", async () => {
    const result = await resolveX402BatchProof({ settlementId: "not-a-uuid" });
    expect(result.verificationLevel).toBe("unresolved");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires the returned transfer ID to match", async () => {
    const client = rpcClient();
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...gatewayBody(), id: OTHER_ID, txHash: TX_HASH }));
    const result = await resolveX402BatchProof({ settlementId: SETTLEMENT_ID, rpcClient: client });
    expect(result.verificationLevel).toBe("unresolved");
    expect(result.txHash).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((client.getTransaction as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("rejects a missing returned transfer ID", async () => {
    const client = rpcClient();
    const body = gatewayBody("completed", { txHash: TX_HASH });
    delete body.id;
    fetchMock.mockResolvedValueOnce(jsonResponse(body));
    const result = await resolveX402BatchProof({
      settlementId: SETTLEMENT_ID,
      rpcClient: client,
      allowLegacyTimestampFallback: true,
    });
    expect(result.verificationLevel).toBe("unresolved");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((client.getTransaction as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it.each(["received", "failed"] as const)("does not process %s transfers", async (status) => {
    const client = rpcClient();
    const result = await resolveOfficial(gatewayBody(status, { txHash: TX_HASH }), client, {
      allowLegacyTimestampFallback: true,
    });
    expect(result.verificationLevel).toBe("unresolved");
    expect(result.gatewayStatus).toBe(status);
    expect(result.txHash).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((client.getTransaction as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("preserves batched with no official hash as unresolved by default", async () => {
    const client = rpcClient();
    const result = await resolveOfficial(gatewayBody("batched"), client);
    expect(result.gatewayStatus).toBe("batched");
    expect(result.verificationLevel).toBe("unresolved");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((client.getTransaction as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("handles unknown status safely as unresolved", async () => {
    const result = await resolveOfficial(gatewayBody("processing", { txHash: TX_HASH }));
    expect(result.verificationLevel).toBe("unresolved");
    expect(result.gatewayStatus).toBeUndefined();
    expect(result.txHash).toBeNull();
  });

  it.each(["batched", "confirmed", "completed"] as const)(
    "processes %s with a valid official txHash",
    async (status) => {
      const result = await resolveOfficial(gatewayBody(status, { txHash: TX_HASH }));
      expect(result.txHash).toBe(TX_HASH);
      expect(result.officialBatchTxHash).toBe(TX_HASH);
      expect(result.matchedBy).toBe("gateway_txhash_field");
      expect(result.verificationLevel).toBe("decoded_batch");
    },
  );

  it("preserves canonical status and transfer fields safely", async () => {
    const result = await resolveOfficial(gatewayBody("confirmed", {
      txHash: TX_HASH,
      token: "USDC",
      sendingNetwork: "eip155:5042002",
      recipientNetwork: "eip155:5042002",
      fromAddress: BUYER,
      toAddress: SELLER,
      amount: "1000000",
      nonce: "42",
      createdAt: UPDATED_AT,
    }));
    expect(result.transferId).toBe(SETTLEMENT_ID);
    expect(result.gatewayStatus).toBe("confirmed");
    expect(result.sendingNetwork).toBe("eip155:5042002");
    expect(result.recipientNetwork).toBe("eip155:5042002");
    expect(result.fromAddress).toBe(BUYER);
    expect(result.toAddress).toBe(SELLER);
    expect(result.amountAtomic).toBe("1000000");
    expect(result.nonce).toBe("42");
  });

  it("preserves decimal atomic amount strings and safely parses numeric nonce", async () => {
    const result = await resolveOfficial(gatewayBody("completed", {
      txHash: TX_HASH,
      amount: "0001000",
      nonce: 7,
    }));
    expect(result.amountAtomic).toBe("0001000");
    expect(result.nonce).toBe("7");
  });

  it.each([
    ["fromAddress", { fromAddress: 42 }],
    ["amount", { amount: {} }],
    ["nonce", { nonce: {} }],
    ["sendingNetwork", { sendingNetwork: 42 }],
    ["updatedAt", { updatedAt: "not-a-timestamp" }],
  ])("rejects malformed canonical %s metadata", async (_field, extra) => {
    const result = await resolveOfficial(gatewayBody("completed", { txHash: TX_HASH, ...extra }));
    expect(result.verificationLevel).toBe("unresolved");
    expect(result.txHash).toBeNull();
  });
});

describe("official txHash precedence and mapping failures", () => {
  it("accepts a valid top-level txHash", async () => {
    const result = await resolveOfficial(gatewayBody("completed", { txHash: TX_HASH }));
    expect(result.txHash).toBe(TX_HASH);
    expect(result.matchedBy).toBe("gateway_txhash_field");
  });

  it("gives a valid top-level txHash priority over nested compatibility fields", async () => {
    const result = await resolveOfficial(gatewayBody("completed", {
      txHash: TX_HASH,
      transaction: { txHash: OTHER_TX_HASH },
    }));
    expect(result.txHash).toBe(TX_HASH);
    expect(result.officialBatchTxHash).toBe(TX_HASH);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed top-level txHash instead of using nested compatibility data", async () => {
    const result = await resolveOfficial(gatewayBody("completed", {
      txHash: "0x123",
      transaction: { txHash: OTHER_TX_HASH },
    }));
    expect(result.verificationLevel).toBe("unresolved");
    expect(result.txHash).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses a nested compatibility hash when top-level txHash is absent", async () => {
    const result = await resolveOfficial(gatewayBody("completed", {
      transaction: { txHash: TX_HASH },
    }));
    expect(result.txHash).toBe(TX_HASH);
    expect(result.matchedBy).toBe("gateway_txhash_field");
  });

  it("returns official_batch_mapping when RPC fetch fails", async () => {
    const result = await resolveOfficial(
      gatewayBody("completed", { txHash: TX_HASH }),
      rpcClient({ throwOnTransaction: true }),
    );
    expect(result.verificationLevel).toBe("official_batch_mapping");
    expect(result.matchedBy).toBe("gateway_txhash_field");
    expect(result.txHash).toBe(TX_HASH);
  });

  it.each([
    ["failed receipt", rpcClient({ receiptStatus: "reverted" })],
    ["wrong outer Gateway Wallet", rpcClient({ to: WRONG })],
    ["wrong inner Gateway Wallet", rpcClient({ fixture: buildFixture({ innerContract: WRONG }) })],
    ["wrong domain", rpcClient({ fixture: buildFixture({ domain: 1 }) })],
    ["wrong token", rpcClient({ fixture: buildFixture({ token: WRONG }) })],
    ["invalid calldata", rpcClient({ fixture: { inner: "0x", input: "0xdeadbeef" as `0x${string}` } })],
    ["unmined transaction", rpcClient({ blockNumber: 0n })],
    ["RPC transaction hash mismatch", rpcClient({ returnedHash: OTHER_TX_HASH })],
  ])("keeps official hash at mapping level for %s", async (_label, client) => {
    const result = await resolveOfficial(gatewayBody("completed", { txHash: TX_HASH }), client, {
      allowLegacyTimestampFallback: true,
      expectedToken: TOKEN,
    });
    expect(result.verificationLevel).toBe("official_batch_mapping");
    expect(result.matchedBy).toBe("gateway_txhash_field");
    expect(result.txHash).toBe(TX_HASH);
    expect(result.officialBatchTxHash).toBe(TX_HASH);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never calls explorer discovery when an official hash exists", async () => {
    const result = await resolveOfficial(gatewayBody("completed", { txHash: TX_HASH }), rpcClient(), {
      allowLegacyTimestampFallback: true,
    });
    expect(result.txHash).toBe(TX_HASH);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("legacy timestamp fallback", () => {
  it("is disabled by default", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(gatewayBody("completed")));
    const result = await resolveX402BatchProof({ settlementId: SETTLEMENT_ID, rpcClient: rpcClient() });
    expect(result.verificationLevel).toBe("unresolved");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("can be explicitly enabled and produces heuristic candidate metadata", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(gatewayBody("batched")))
      .mockResolvedValueOnce(jsonResponse(explorerBody()));
    const result = await resolveX402BatchProof({
      settlementId: SETTLEMENT_ID,
      allowLegacyTimestampFallback: true,
      rpcClient: rpcClient(),
    });
    expect(result.verificationLevel).toBe("decoded_batch");
    expect(result.matchedBy).toBe("legacy_timestamp_candidate");
    expect(result.txHash).toBe(TX_HASH);
  });

  it("returns legacy_timestamp_candidate when the legacy candidate cannot be decoded", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(gatewayBody("completed")))
      .mockResolvedValueOnce(jsonResponse(explorerBody()));
    const result = await resolveX402BatchProof({
      settlementId: SETTLEMENT_ID,
      allowLegacyTimestampFallback: true,
      rpcClient: rpcClient({ throwOnTransaction: true }),
    });
    expect(result.verificationLevel).toBe("legacy_timestamp_candidate");
    expect(result.matchedBy).toBe("legacy_timestamp_candidate");
    expect(result.txHash).toBe(TX_HASH);
  });

  it("uses decoded_delta only when expected legacy addresses all match", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(gatewayBody("completed")))
      .mockResolvedValueOnce(jsonResponse(explorerBody()));
    const result = await resolveX402BatchProof({
      settlementId: SETTLEMENT_ID,
      allowLegacyTimestampFallback: true,
      expectedBuyer: BUYER as `0x${string}`,
      expectedSeller: SELLER as `0x${string}`,
      rpcClient: rpcClient(),
    });
    expect(result.verificationLevel).toBe("address_participation");
    expect(result.matchedBy).toBe("decoded_delta");
  });
});

describe("address participation", () => {
  it("returns decoded_batch with no expected addresses", async () => {
    const result = await resolveOfficial();
    expect(result.verificationLevel).toBe("decoded_batch");
    expect(result.buyerVerified).toBeUndefined();
    expect(result.sellerVerified).toBeUndefined();
  });

  it("requires a negative buyer delta", async () => {
    const result = await resolveOfficial(gatewayBody("completed", { txHash: TX_HASH }), rpcClient(), {
      expectedBuyer: BUYER,
    });
    expect(result.verificationLevel).toBe("address_participation");
    expect(result.buyerVerified).toBe(true);
  });

  it("marks a missing buyer without downgrading the official mapping", async () => {
    const result = await resolveOfficial(gatewayBody("completed", { txHash: TX_HASH }), rpcClient(), {
      expectedBuyer: WRONG,
    });
    expect(result.verificationLevel).toBe("decoded_batch");
    expect(result.matchedBy).toBe("gateway_txhash_field");
    expect(result.buyerVerified).toBe(false);
  });

  it("requires a positive seller delta", async () => {
    const result = await resolveOfficial(gatewayBody("completed", { txHash: TX_HASH }), rpcClient(), {
      expectedSeller: SELLER,
    });
    expect(result.verificationLevel).toBe("address_participation");
    expect(result.sellerVerified).toBe(true);
  });

  it("marks a missing seller", async () => {
    const result = await resolveOfficial(gatewayBody("completed", { txHash: TX_HASH }), rpcClient(), {
      expectedSeller: WRONG,
    });
    expect(result.verificationLevel).toBe("decoded_batch");
    expect(result.sellerVerified).toBe(false);
  });

  it("requires both buyer and seller when both are supplied", async () => {
    const result = await resolveOfficial(gatewayBody("completed", { txHash: TX_HASH }), rpcClient(), {
      expectedBuyer: BUYER,
      expectedSeller: SELLER,
    });
    expect(result.verificationLevel).toBe("address_participation");
    expect(result.buyerVerified).toBe(true);
    expect(result.sellerVerified).toBe(true);
  });

  it("does not claim address participation when both expected addresses are missing", async () => {
    const result = await resolveOfficial(gatewayBody("completed", { txHash: TX_HASH }), rpcClient(), {
      expectedBuyer: WRONG,
      expectedSeller: WRONG,
    });
    expect(result.verificationLevel).toBe("decoded_batch");
    expect(result.buyerVerified).toBe(false);
    expect(result.sellerVerified).toBe(false);
  });
});

describe("manual hash and safe metadata", () => {
  it("supports an operator-provided manual transaction hash", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(gatewayBody("completed")));
    const result = await resolveX402BatchProof({
      settlementId: SETTLEMENT_ID,
      manualTxHash: TX_HASH,
      rpcClient: rpcClient(),
    });
    expect(result.matchedBy).toBe("manual_tx");
    expect(result.verificationLevel).toBe("decoded_batch");
    expect(result.officialBatchTxHash).toBeUndefined();
  });

  it("does not expose unknown or unsafe API fields", async () => {
    const result = await resolveOfficial(gatewayBody("completed", {
      txHash: TX_HASH,
      signature: "must-not-escape",
      entitySecret: "must-not-escape",
      unknownObject: { apiKey: "must-not-escape" },
    }));
    expect(result).not.toHaveProperty("signature");
    expect(result).not.toHaveProperty("entitySecret");
    expect(result).not.toHaveProperty("unknownObject");
    expect(JSON.stringify(result)).not.toContain("must-not-escape");
  });
});
