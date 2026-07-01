import { describe, it, expect } from "vitest";
import { encodeBatchProof, decodeBatchProof } from "../src/proof-codec.js";
import type { X402BatchProof } from "../src/types.js";

const VALID_PROOF: X402BatchProof = {
  v: 1,
  settlementId: "550e8400-e29b-41d4-a716-446655440000",
  status: "completed",
  txHash: "0x" + "a".repeat(64),
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
