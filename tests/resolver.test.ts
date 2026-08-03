import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, type PublicClient } from "viem";
import { SUBMIT_BATCH_ABI } from "../src/abi.js";
import { findSubmitBatchCandidates } from "../src/explorer.js";
import { resolveX402BatchProof } from "../src/resolver.js";

const SETTLEMENT_ID = "550e8400-e29b-41d4-a716-446655440000";
const WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const TOKEN = "0x3600000000000000000000000000000000000000";
const BUYER = "0x0000000000000000000000000000000000000001";
const SELLER = "0x0000000000000000000000000000000000000002";
const WRONG = "0x0000000000000000000000000000000000000003";
const TX_HASH = ("0x" + "a".repeat(64)) as `0x${string}`;
const UPDATED_AT = "2026-01-01T00:00:00.000Z";
const CANDIDATE_TIME = "2026-01-01T00:00:01.000Z";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

function wordFromAddress(address: string): string {
  return "0".repeat(24) + address.slice(2).toLowerCase();
}

function buildInner(domain = 26, token = TOKEN, innerContract = WALLET): `0x${string}` {
  const pad = (value: string) => value.padStart(64, "0");
  const negative = ((1n << 256n) - 1_000_000n).toString(16).padStart(64, "0");
  return (`0x${[
    pad("a0"),
    "91".padEnd(64, "0"),
    pad(domain.toString(16)),
    wordFromAddress(token),
    wordFromAddress(innerContract),
    pad("2"),
    wordFromAddress(BUYER),
    negative,
    wordFromAddress(SELLER),
    pad("f4240"),
  ].join("")}`) as `0x${string}`;
}

function buildFixture(overrides: { domain?: number; token?: string; innerContract?: string } = {}) {
  const inner = buildInner(overrides.domain, overrides.token, overrides.innerContract);
  const input = encodeFunctionData({
    abi: SUBMIT_BATCH_ABI,
    args: [inner, "0x"],
  });
  return { inner, input };
}

function rpcClient(
  fixture = buildFixture(),
  overrides: { to?: string; receiptStatus?: "success" | "reverted"; throwOnDecode?: boolean } = {},
): PublicClient {
  return {
    getTransaction: async () => {
      if (overrides.throwOnDecode) throw new Error("rpc unavailable");
      return {
        hash: TX_HASH,
        to: (overrides.to ?? WALLET) as `0x${string}`,
        from: "0x0000000000000000000000000000000000000099" as `0x${string}`,
        input: fixture.input,
        blockNumber: 123n,
      };
    },
    getTransactionReceipt: async () => ({ status: overrides.receiptStatus ?? "success" }),
    getBlock: async () => ({ timestamp: 1_767_220_800n }),
  } as unknown as PublicClient;
}

function gatewayBody(status = "completed", updatedAt: string | null = UPDATED_AT) {
  return { status, updatedAt };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolver status separation", () => {
  it("rejects an invalid settlement UUID without fetching Gateway", async () => {
    const result = await resolveX402BatchProof({ settlementId: "not-a-uuid" });
    expect(result.verificationLevel).toBe("unresolved");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves Gateway fetch failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));
    const result = await resolveX402BatchProof({ settlementId: SETTLEMENT_ID });
    expect(result.gatewayStatus).toBeUndefined();
    expect(result.verificationLevel).toBe("unresolved");
  });

  it("preserves pending Gateway status and does not claim inclusion", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(gatewayBody("pending")));
    const result = await resolveX402BatchProof({ settlementId: SETTLEMENT_ID });
    expect(result.gatewayStatus).toBe("pending");
    expect(result.status).toBe("pending");
    expect(result.verificationLevel).toBe("unresolved");
  });

  it("preserves confirmed Gateway status", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(gatewayBody("confirmed", null)));
    const result = await resolveX402BatchProof({ settlementId: SETTLEMENT_ID });
    expect(result.gatewayStatus).toBe("confirmed");
    expect(result.verificationLevel).toBe("unresolved");
  });

  it("decodes a Gateway-provided transaction hash and verifies both directions", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: "completed", transaction: { txHash: TX_HASH }, updatedAt: "bad" }),
    );
    const result = await resolveX402BatchProof({
      settlementId: SETTLEMENT_ID,
      expectedBuyer: BUYER as `0x${string}`,
      expectedSeller: SELLER as `0x${string}`,
      rpcClient: rpcClient(),
    });
    expect(result.matchedBy).toBe("gateway_txhash_field");
    expect(result.verificationLevel).toBe("address_participation");
    expect(result.buyerVerified).toBe(true);
    expect(result.sellerVerified).toBe(true);
  });

  it("uses an explorer candidate when Gateway has no transaction hash", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(gatewayBody()))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ hash: TX_HASH, timestamp: CANDIDATE_TIME, method: "submitBatch" }],
          next_page_params: null,
        }),
      );
    const result = await resolveX402BatchProof({
      settlementId: SETTLEMENT_ID,
      rpcClient: rpcClient(),
    });
    expect(result.verificationLevel).toBe("decoded_batch");
    expect(result.matchedBy).toBeUndefined();
    expect(result.entriesCount).toBe(2);
  });

  it("returns unresolved for no explorer candidates", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(gatewayBody()))
      .mockResolvedValueOnce(jsonResponse({ items: [], next_page_params: null }));
    const result = await resolveX402BatchProof({ settlementId: SETTLEMENT_ID, rpcClient: rpcClient() });
    expect(result.verificationLevel).toBe("unresolved");
    expect(result.txHash).toBeNull();
  });

  it("keeps a timestamp candidate when RPC decoding fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(gatewayBody()))
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ hash: TX_HASH, timestamp: CANDIDATE_TIME, method: "submitBatch" }], next_page_params: null }),
      );
    const result = await resolveX402BatchProof({
      settlementId: SETTLEMENT_ID,
      expectedBuyer: BUYER as `0x${string}`,
      rpcClient: rpcClient(buildFixture(), { throwOnDecode: true }),
    });
    expect(result.verificationLevel).toBe("timestamp_candidate");
    expect(result.buyerVerified).toBeUndefined();
  });

  it("never upgrades timestamp-only discovery to verified participation", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(gatewayBody()))
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ hash: TX_HASH, timestamp: CANDIDATE_TIME, method: "submitBatch" }], next_page_params: null }),
      );
    const result = await resolveX402BatchProof({
      settlementId: SETTLEMENT_ID,
      expectedBuyer: BUYER as `0x${string}`,
      rpcClient: rpcClient(buildFixture(), { receiptStatus: "reverted" }),
    });
    expect(result.verificationLevel).toBe("timestamp_candidate");
    expect(result.matchedBy).toBe("timestamp_candidate");
  });

  it("supports buyer-only and seller-only participation checks", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: "completed", transaction: { txHash: TX_HASH }, updatedAt: null }));
    const buyerOnly = await resolveX402BatchProof({
      settlementId: SETTLEMENT_ID,
      expectedBuyer: BUYER as `0x${string}`,
      rpcClient: rpcClient(),
    });
    expect(buyerOnly.verificationLevel).toBe("address_participation");
    expect(buyerOnly.sellerVerified).toBeUndefined();

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: "completed", transaction: { txHash: TX_HASH }, updatedAt: null }));
    const sellerOnly = await resolveX402BatchProof({
      settlementId: SETTLEMENT_ID,
      expectedSeller: SELLER as `0x${string}`,
      rpcClient: rpcClient(),
    });
    expect(sellerOnly.verificationLevel).toBe("address_participation");
    expect(sellerOnly.buyerVerified).toBeUndefined();
  });

  it("returns decoded batch evidence without payment verification when addresses are omitted", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: "completed", transaction: { txHash: TX_HASH }, updatedAt: null }),
    );
    const result = await resolveX402BatchProof({ settlementId: SETTLEMENT_ID, rpcClient: rpcClient() });
    expect(result.verificationLevel).toBe("decoded_batch");
    expect(result.buyerVerified).toBeUndefined();
    expect(result.sellerVerified).toBeUndefined();
  });

  it("requires both expected addresses when both are supplied", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: "completed", transaction: { txHash: TX_HASH }, updatedAt: null }),
    );
    const result = await resolveX402BatchProof({
      settlementId: SETTLEMENT_ID,
      expectedBuyer: WRONG as `0x${string}`,
      expectedSeller: SELLER as `0x${string}`,
      rpcClient: rpcClient(),
    });
    expect(result.verificationLevel).toBe("decoded_batch");
    expect(result.buyerVerified).toBe(false);
    expect(result.sellerVerified).toBe(true);
  });

  it("supports a manual transaction hash", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(gatewayBody("completed", null)));
    const result = await resolveX402BatchProof({
      settlementId: SETTLEMENT_ID,
      manualTxHash: TX_HASH,
      rpcClient: rpcClient(),
    });
    expect(result.matchedBy).toBe("manual_tx");
    expect(result.verificationLevel).toBe("decoded_batch");
  });
});

describe("resolver and explorer validation", () => {
  it("rejects malformed explorer responses and timestamps", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(gatewayBody()))
      .mockResolvedValueOnce(jsonResponse({ items: [{ hash: TX_HASH, timestamp: "bad", method: "submitBatch" }], next_page_params: null }));
    const result = await resolveX402BatchProof({ settlementId: SETTLEMENT_ID, rpcClient: rpcClient() });
    expect(result.verificationLevel).toBe("unresolved");

    fetchMock
      .mockResolvedValueOnce(jsonResponse(gatewayBody()))
      .mockResolvedValueOnce(jsonResponse({ items: "not-an-array", next_page_params: null }));
    const malformed = await resolveX402BatchProof({ settlementId: SETTLEMENT_ID, rpcClient: rpcClient() });
    expect(malformed.verificationLevel).toBe("unresolved");
  });

  it("paginates beyond page one and sorts all candidates by distance", async () => {
    const farther = ("0x" + "b".repeat(64)) as `0x${string}`;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        items: [{ hash: farther, timestamp: "2026-01-01T00:00:10.000Z", method: "submitBatch" }],
        next_page_params: { page: "2" },
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [{ hash: TX_HASH, timestamp: CANDIDATE_TIME, method: "submitBatch" }],
        next_page_params: null,
      }));
    const candidates = await findSubmitBatchCandidates("https://testnet.arcscan.app", WALLET, Date.parse(UPDATED_AT), 5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(candidates.map((candidate) => candidate.txHash)).toEqual([TX_HASH, farther]);
  });

  it("inspects multiple candidates and prefers the nearest successfully decoded match", async () => {
    const farther = ("0x" + "c".repeat(64)) as `0x${string}`;
    const valid = buildFixture();
    const client = {
      getTransaction: async ({ hash }: { hash: string }) => ({
        hash,
        to: WALLET as `0x${string}`,
        from: "0x0000000000000000000000000000000000000099" as `0x${string}`,
        input: hash.toLowerCase() === TX_HASH.toLowerCase() ? "0xdeadbeef" : valid.input,
        blockNumber: 123n,
      }),
      getTransactionReceipt: async () => ({ status: "success" }),
      getBlock: async () => ({ timestamp: 1_767_220_800n }),
    } as unknown as PublicClient;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(gatewayBody()))
      .mockResolvedValueOnce(jsonResponse({
        items: [
          { hash: TX_HASH, timestamp: CANDIDATE_TIME, method: "submitBatch" },
          { hash: farther, timestamp: "2026-01-01T00:00:02.000Z", method: "submitBatch" },
        ],
        next_page_params: null,
      }));
    const result = await resolveX402BatchProof({
      settlementId: SETTLEMENT_ID,
      expectedBuyer: BUYER as `0x${string}`,
      expectedSeller: SELLER as `0x${string}`,
      rpcClient: client,
    });
    expect(result.txHash).toBe(farther);
    expect(result.verificationLevel).toBe("address_participation");
  });

  it("rejects unrelated candidates outside the configured time window", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      items: [{ hash: TX_HASH, timestamp: "2026-01-01T00:01:00.000Z", method: "submitBatch" }],
      next_page_params: null,
    }));
    const candidates = await findSubmitBatchCandidates("https://testnet.arcscan.app", WALLET, Date.parse(UPDATED_AT), 5, 5_000);
    expect(candidates).toEqual([]);
  });

  it.each([
    ["wrong Gateway wallet", rpcClient(buildFixture(), { to: "0x0000000000000000000000000000000000000099" })],
    ["wrong innerContract", rpcClient(buildFixture({ innerContract: "0x0000000000000000000000000000000000000099" }) )],
    ["wrong domain", rpcClient(buildFixture({ domain: 1 }) )],
    ["wrong token", rpcClient(buildFixture({ token: "0x0000000000000000000000000000000000000009" }) )],
  ])("keeps %s as a timestamp candidate", async (_name, client) => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(gatewayBody()))
      .mockResolvedValueOnce(jsonResponse({ items: [{ hash: TX_HASH, timestamp: CANDIDATE_TIME, method: "submitBatch" }], next_page_params: null }));
    const result = await resolveX402BatchProof({
      settlementId: SETTLEMENT_ID,
      expectedToken: TOKEN,
      rpcClient: client,
    });
    expect(result.verificationLevel).toBe("timestamp_candidate");
  });
});
