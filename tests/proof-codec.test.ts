import { describe, it, expect } from "vitest";
import { encodeBatchProof, decodeBatchProof } from "../src/proof-codec.js";
import type { X402BatchProof } from "../src/types.js";

const NONCE = ("0x" + "1".repeat(64)) as `0x${string}`;
const VALID_PROOF: X402BatchProof = {
  v: 1,
  settlementId: "550e8400-e29b-41d4-a716-446655440000",
  status: "completed",
  verificationLevel: "address_participation",
  txHash: ("0x" + "a".repeat(64)) as `0x${string}`,
  explorerUrl: "https://testnet.arcscan.app/tx/0x" + "a".repeat(64),
  batchId: ("0x" + "b".repeat(64)) as `0x${string}`,
  domain: 26,
  token: ("0x" + "c".repeat(40)) as `0x${string}`,
  gatewayWallet: ("0x" + "d".repeat(40)) as `0x${string}`,
  entriesCount: 39,
  netTransfersCount: 39,
  buyerVerified: true,
  sellerVerified: true,
  buyerEntry: {
    address: ("0x" + "1".repeat(40)) as `0x${string}`,
    usdc: "-0.119100",
  },
  sellerEntry: {
    address: ("0x" + "2".repeat(40)) as `0x${string}`,
    usdc: "+0.119100",
  },
  matchedBy: "decoded_delta",
};

describe("encodeBatchProof / decodeBatchProof roundtrip", () => {
  it("roundtrips a valid proof", () => {
    const encoded = encodeBatchProof(VALID_PROOF);
    expect(typeof encoded).toBe("string");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");

    const decoded = decodeBatchProof(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.v).toBe(1);
    expect(decoded!.settlementId).toBe(VALID_PROOF.settlementId);
    expect(decoded!.txHash).toBe(VALID_PROOF.txHash);
    expect(decoded!.entriesCount).toBe(39);
    expect(decoded!.buyerVerified).toBe(true);
    expect(decoded!.matchedBy).toBe("decoded_delta");
  });

  it("roundtrips minimal proof (txHash null)", () => {
    const minimal: X402BatchProof = {
      v: 1,
      verificationLevel: "unresolved",
      txHash: null,
      explorerUrl: null,
      entriesCount: 0,
      netTransfersCount: 0,
    };
    const encoded = encodeBatchProof(minimal);
    const decoded = decodeBatchProof(encoded);
    expect(decoded!.txHash).toBeNull();
    expect(decoded!.entriesCount).toBe(0);
  });

  it("rejects proof with wrong version", () => {
    const bad = { ...VALID_PROOF, v: 2 } as unknown as X402BatchProof;
    expect(() => encodeBatchProof(bad)).toThrow("Unsupported proof version");
  });

  it("rejects encoded proof with wrong version on decode", () => {
    // Manually encode a v2 proof
    const json = JSON.stringify({ ...VALID_PROOF, v: 2 });
    const b64 = Buffer.from(json).toString("base64");
    expect(decodeBatchProof(b64)).toBeNull();
  });

  it("rejects invalid base64 on decode", () => {
    expect(decodeBatchProof("not-valid-base64!!!")).toBeNull();
  });

  it("rejects non-object JSON on decode", () => {
    const b64 = Buffer.from('"hello"').toString("base64");
    expect(decodeBatchProof(b64)).toBeNull();
  });

  it.each([
    ["bad tx hash", { txHash: "0x123" }],
    ["bad explorer URL", { explorerUrl: "https://evil.example/tx/0x" + "a".repeat(64) }],
    ["negative count", { entriesCount: -1 }],
    ["bad verification enum", { verificationLevel: "verified" }],
    ["unsupported nested value", { extra: { value: NaN } }],
  ])("rejects %s", (_label, patch) => {
    expect(() => encodeBatchProof({ ...VALID_PROOF, ...patch } as X402BatchProof)).toThrow();
  });

  it("rejects unknown top-level schema fields on decode", () => {
    const json = JSON.stringify({ ...VALID_PROOF, unknown: true });
    const encoded = Buffer.from(json).toString("base64url");
    expect(decodeBatchProof(encoded)).toBeNull();
  });
});

describe("portable canonical Gateway metadata", () => {
  it("roundtrips validated transfer metadata", () => {
    const proof: X402BatchProof = {
      ...VALID_PROOF,
      transferId: "550e8400-e29b-41d4-a716-446655440000",
      gatewayStatus: "completed",
      sendingNetwork: "eip155:5042002",
      recipientNetwork: "eip155:5042002",
      fromAddress: ("0x" + "1".repeat(40)) as `0x${string}`,
      toAddress: ("0x" + "2".repeat(40)) as `0x${string}`,
      amountAtomic: "1000000",
      nonce: NONCE,
      officialBatchTxHash: VALID_PROOF.txHash!,
      matchedBy: "gateway_txhash_field",
    };
    const decoded = decodeBatchProof(encodeBatchProof(proof));
    expect(decoded?.gatewayStatus).toBe("completed");
    expect(decoded?.amountAtomic).toBe("1000000");
    expect(decoded?.nonce).toBe(NONCE);
    expect(decoded?.officialBatchTxHash).toBe(proof.officialBatchTxHash);
  });

  it.each([
    ["invalid transfer ID", { transferId: "not-a-uuid" }],
    ["invalid Gateway status", { gatewayStatus: "processing" }],
    ["invalid amount", { amountAtomic: "1.5" }],
    ["decimal nonce", { nonce: "42" }],
    ["numeric nonce", { nonce: 42 }],
    ["short hex nonce", { nonce: "0x1234" }],
    ["malformed hex nonce", { nonce: "0x" + "g".repeat(64) }],
    ["invalid address", { fromAddress: "0x123" }],
    ["invalid official hash", { officialBatchTxHash: "0x123" }],
  ])("rejects %s", (_label, patch) => {
    expect(() => encodeBatchProof({ ...VALID_PROOF, ...patch } as X402BatchProof)).toThrow();
  });
  it("rejects contradictory official mapping metadata", () => {
    expect(() => encodeBatchProof({
      ...VALID_PROOF,
      verificationLevel: "official_batch_mapping",
      matchedBy: "gateway_txhash_field",
    })).toThrow();
    expect(() => encodeBatchProof({
      ...VALID_PROOF,
      matchedBy: "gateway_txhash_field",
    })).toThrow();
    expect(() => encodeBatchProof({
      ...VALID_PROOF,
      officialBatchTxHash: ("0x" + "e".repeat(64)) as `0x${string}`,
    })).toThrow();
  });

  it("rejects contradictory transfer IDs and statuses", () => {
    expect(() => encodeBatchProof({
      ...VALID_PROOF,
      transferId: "550e8400-e29b-41d4-a716-446655440001",
    })).toThrow();
    expect(() => encodeBatchProof({
      ...VALID_PROOF,
      gatewayStatus: "confirmed",
      status: "completed",
    })).toThrow();
  });

  it("accepts and rejects complete evidence combinations for every verification level", () => {
    const hash = ("0x" + "a".repeat(64)) as `0x${string}`;
    const base = {
      v: 1 as const,
      txHash: hash,
      explorerUrl: "https://testnet.arcscan.app/tx/" + hash,
      batchId: ("0x" + "b".repeat(64)) as `0x${string}`,
      domain: 26,
      token: ("0x" + "c".repeat(40)) as `0x${string}`,
      gatewayWallet: ("0x" + "d".repeat(40)) as `0x${string}`,
      entriesCount: 2,
      netTransfersCount: 1,
    };
    const valid = [
      { v: 1 as const, verificationLevel: "unresolved" as const, txHash: null, explorerUrl: null, entriesCount: 0, netTransfersCount: 0 },
      { verificationLevel: "official_batch_mapping" as const, v: 1 as const, txHash: hash, explorerUrl: base.explorerUrl, entriesCount: 0, netTransfersCount: 0, matchedBy: "gateway_txhash_field" as const, officialBatchTxHash: hash },
      { v: 1 as const, verificationLevel: "legacy_timestamp_candidate" as const, txHash: hash, explorerUrl: base.explorerUrl, entriesCount: 0, netTransfersCount: 0, matchedBy: "legacy_timestamp_candidate" as const },
      { verificationLevel: "decoded_batch" as const, ...base },
      { ...VALID_PROOF },
    ];
    for (const proof of valid) expect(decodeBatchProof(encodeBatchProof(proof as X402BatchProof))).not.toBeNull();

    const invalid = [
      { ...valid[0], batchId: base.batchId },
      { ...valid[1], officialBatchTxHash: undefined },
      { ...valid[2], txHash: null },
      { ...valid[3], token: undefined },
      { ...valid[3], matchedBy: "legacy_timestamp_candidate" },
      { ...VALID_PROOF, buyerVerified: false },
      { ...VALID_PROOF, buyerVerified: true, buyerEntry: undefined },
      { ...VALID_PROOF, matchedBy: "decoded_delta", officialBatchTxHash: hash },
    ];
    for (const proof of invalid) expect(() => encodeBatchProof(proof as X402BatchProof)).toThrow();
  });
});

describe("unsafe field rejection (recursive)", () => {
  const UNSAFE_FIELDS = [
    "signature",
    "paymentSignature",
    "xPayment",
    "paymentHeader",
    "eip712",
    "typedData",
    "entitySecret",
    "entitySecretCiphertext",
    "privateKey",
    "apiKey",
    "authorization",
    "walletId",
  ];

  for (const field of UNSAFE_FIELDS) {
    it(`rejects top-level field: ${field}`, () => {
      const bad = { ...VALID_PROOF, [field]: "sneaky" };
      expect(() => encodeBatchProof(bad as X402BatchProof)).toThrow(
        "unsafe field",
      );
    });
  }

  it("rejects unsafe field nested one level deep", () => {
    const bad = {
      ...VALID_PROOF,
      extra: { signature: "nested-bad" },
    };
    expect(() => encodeBatchProof(bad as X402BatchProof)).toThrow(
      "unsafe field",
    );
  });

  it("rejects unsafe field nested two levels deep", () => {
    const bad = {
      ...VALID_PROOF,
      meta: { details: { privateKey: "deep-bad" } },
    };
    expect(() => encodeBatchProof(bad as X402BatchProof)).toThrow(
      "unsafe field",
    );
  });

  it("rejects unsafe field in array", () => {
    const bad = {
      ...VALID_PROOF,
      items: [{ apiKey: "in-array" }],
    };
    expect(() => encodeBatchProof(bad as X402BatchProof)).toThrow(
      "unsafe field",
    );
  });

  it("rejects unsafe field in encoded proof on decode", () => {
    // Encode a proof that has an unsafe field by bypassing the encoder
    const bad = { ...VALID_PROOF, signature: "sneaky" };
    const json = JSON.stringify(bad);
    const b64 = Buffer.from(json).toString("base64");
    expect(decodeBatchProof(b64)).toBeNull();
  });

  it("case-insensitive key matching", () => {
    const bad = { ...VALID_PROOF, APIKEY: "sneaky" };
    expect(() => encodeBatchProof(bad as X402BatchProof)).toThrow(
      "unsafe field",
    );
  });
});

describe("JSON normalization and legacy v1 migration", () => {
  const legacyBase = {
    v: 1,
    settlementId: "550e8400-e29b-41d4-a716-446655440000",
    status: "completed",
    txHash: "0x" + "a".repeat(64),
    explorerUrl: "https://testnet.arcscan.app/tx/0x" + "a".repeat(64),
    entriesCount: 0,
    netTransfersCount: 0,
  };
  const legacyFixture = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const decodedContext = {
    batchId: "0x" + "b".repeat(64),
    domain: 26,
    token: "0x" + "c".repeat(40),
    gatewayWallet: "0x" + "d".repeat(40),
    entriesCount: 2,
    netTransfersCount: 1,
  };

  it("encodes resolver-style optional undefined fields after JSON normalization", () => {
    const proof = {
      ...VALID_PROOF,
      verificationLevel: "decoded_batch",
      buyerVerified: undefined,
      sellerVerified: undefined,
      buyerEntry: undefined,
      sellerEntry: undefined,
      matchedBy: undefined,
    } as unknown as X402BatchProof;
    const decoded = decodeBatchProof(encodeBatchProof(proof));
    expect(decoded).not.toBeNull();
    expect(decoded).not.toHaveProperty("buyerVerified");
    expect(decoded).not.toHaveProperty("matchedBy");
  });

  it("rejects unsafe keys even when their values are undefined", () => {
    expect(() => encodeBatchProof({ ...VALID_PROOF, authorization: undefined } as unknown as X402BatchProof)).toThrow("unsafe field");
  });

  it("rejects undefined array elements instead of accepting JSON null coercion", () => {
    expect(() => encodeBatchProof({ ...VALID_PROOF, limitations: [undefined] } as unknown as X402BatchProof)).toThrow();
  });

  it.each([
    ["cyclic objects", (() => { const value: Record<string, unknown> = { ...VALID_PROOF }; value.self = value; return value; })()],
    ["BigInt values", { ...VALID_PROOF, extra: 1n }],
    ["unsupported objects", { ...VALID_PROOF, extra: new Date() }],
  ])("fails safely for %s", (_label, value) => {
    expect(() => encodeBatchProof(value as X402BatchProof)).toThrow();
  });

  it("roundtrips a resolver result with no expected buyer or seller", () => {
    const proof = {
      ...VALID_PROOF,
      verificationLevel: "decoded_batch",
      matchedBy: undefined,
      buyerVerified: undefined,
      sellerVerified: undefined,
      buyerEntry: undefined,
      sellerEntry: undefined,
    } as unknown as X402BatchProof;
    expect(decodeBatchProof(encodeBatchProof(proof))).toMatchObject({ verificationLevel: "decoded_batch" });
  });

  it("migrates the legacy unresolved fixture", () => {
    const encoded = legacyFixture({ ...legacyBase, status: "unresolved", txHash: null, explorerUrl: null });
    expect(decodeBatchProof(encoded)).toMatchObject({ v: 1, verificationLevel: "unresolved", txHash: null });
  });

  it("migrates the exact legacy decoded timestamp proof as decoded batch evidence", () => {
    const oldDecodedTimestampProof = {
      v: 1,
      settlementId: legacyBase.settlementId,
      status: "completed",
      txHash: legacyBase.txHash,
      explorerUrl: legacyBase.explorerUrl,
      batchId: decodedContext.batchId,
      domain: 26,
      token: decodedContext.token,
      gatewayWallet: decodedContext.gatewayWallet,
      entriesCount: 2,
      netTransfersCount: 1,
      matchedBy: "timestamp_candidate",
    };
    const decoded = decodeBatchProof(legacyFixture(oldDecodedTimestampProof));

    expect(decoded).toMatchObject({
      verificationLevel: "decoded_batch",
      txHash: legacyBase.txHash,
      batchId: decodedContext.batchId,
      domain: 26,
      token: decodedContext.token,
      gatewayWallet: decodedContext.gatewayWallet,
      entriesCount: 2,
      netTransfersCount: 1,
    });
    expect(decoded).not.toHaveProperty("matchedBy");
  });

  it("preserves a false legacy buyer verification without contradictory entry data", () => {
    const encoded = legacyFixture({
      ...legacyBase,
      ...decodedContext,
      matchedBy: "timestamp_candidate",
      buyerVerified: false,
    });
    const decoded = decodeBatchProof(encoded);

    expect(decoded).toMatchObject({ verificationLevel: "decoded_batch", buyerVerified: false });
    expect(decoded).not.toHaveProperty("buyerEntry");
  });

  it("rejects a timestamp candidate with nonzero counts but incomplete decoded context", () => {
    const encoded = legacyFixture({
      ...legacyBase,
      entriesCount: 2,
      netTransfersCount: 1,
      matchedBy: "timestamp_candidate",
    });
    expect(decodeBatchProof(encoded)).toBeNull();
  });

  it("migrates a legacy timestamp candidate", () => {
    const encoded = legacyFixture({ ...legacyBase, matchedBy: "timestamp_candidate" });
    expect(decodeBatchProof(encoded)).toMatchObject({ verificationLevel: "legacy_timestamp_candidate", matchedBy: "legacy_timestamp_candidate" });
  });

  it("migrates a legacy Gateway hash conservatively", () => {
    const encoded = legacyFixture({ ...legacyBase, matchedBy: "gateway_txhash_field" });
    expect(decodeBatchProof(encoded)).toMatchObject({ verificationLevel: "official_batch_mapping", officialBatchTxHash: legacyBase.txHash });
  });

  it("migrates a complete legacy decoded batch", () => {
    const encoded = legacyFixture({ ...legacyBase, ...decodedContext, matchedBy: "gateway_txhash_field" });
    expect(decodeBatchProof(encoded)).toMatchObject({ verificationLevel: "decoded_batch", batchId: decodedContext.batchId });
  });

  it("preserves safe legacy address participation", () => {
    const encoded = legacyFixture({
      ...legacyBase,
      ...decodedContext,
      matchedBy: "decoded_delta",
      buyerVerified: true,
      buyerEntry: { address: "0x" + "1".repeat(40), usdc: "-1.000000" },
    });
    expect(decodeBatchProof(encoded)).toMatchObject({ verificationLevel: "address_participation", buyerVerified: true });
  });

  it("downgrades contradictory legacy participation to decoded_batch", () => {
    const encoded = legacyFixture({
      ...legacyBase,
      ...decodedContext,
      matchedBy: "decoded_delta",
      buyerVerified: true,
      buyerEntry: { address: "0x" + "1".repeat(40), usdc: "-1.000000" },
      sellerVerified: false,
    });
    expect(decodeBatchProof(encoded)).toMatchObject({ verificationLevel: "decoded_batch" });
    expect(decodeBatchProof(encoded)).not.toHaveProperty("sellerVerified");
  });

  it.each([
    ["invalid hash", { ...legacyBase, txHash: "0x123" }],
    ["unsupported key", { ...legacyBase, unsupported: true }],
    ["unsafe field", { ...legacyBase, authorization: "secret" }],
  ])("rejects legacy %s", (_label, value) => {
    expect(decodeBatchProof(legacyFixture(value))).toBeNull();
  });
});
