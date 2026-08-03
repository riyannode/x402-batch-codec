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
