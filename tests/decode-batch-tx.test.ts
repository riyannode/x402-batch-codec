import { describe, it, expect } from "vitest";
import { decodeSubmitBatchInput } from "../src/decode-batch-tx.js";
import { SUBMIT_BATCH_ABI } from "../src/abi.js";
import { encodeFunctionData, type Hex } from "viem";

describe("decodeSubmitBatchInput", () => {
  function buildSubmitBatchInput(
    calldataBytes: `0x${string}`,
    signature: `0x${string}`,
  ): `0x${string}` {
    return encodeFunctionData({
      abi: SUBMIT_BATCH_ABI,
      args: [calldataBytes, signature],
    });
  }

  it("decodes valid submitBatch input", () => {
    const calldataBytes = ("0x" + "aa".repeat(100)) as `0x${string}`;
    const signature = ("0x" + "bb".repeat(65)) as `0x${string}`;
    const input = buildSubmitBatchInput(calldataBytes, signature);

    const result = decodeSubmitBatchInput(input);
    expect(result).not.toBeNull();
    expect(result!.calldataBytes).toBe(calldataBytes);
    expect(result!.hasSignature).toBe(true);
    expect(result!.signatureBytesLength).toBe(65);
  });

  it("hasSignature false for empty signature", () => {
    const calldataBytes = ("0x" + "aa".repeat(100)) as `0x${string}`;
    const signature = "0x" as `0x${string}`;
    const input = buildSubmitBatchInput(calldataBytes, signature);
    const result = decodeSubmitBatchInput(input);
    expect(result).not.toBeNull();
    expect(result!.hasSignature).toBe(false);
    expect(result!.signatureBytesLength).toBe(0);
  });

  it("does not return raw signature", () => {
    const calldataBytes = ("0x" + "aa".repeat(100)) as `0x${string}`;
    const signature = ("0x" + "bb".repeat(65)) as `0x${string}`;
    const input = buildSubmitBatchInput(calldataBytes, signature);
    const result = decodeSubmitBatchInput(input);
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("signature");
  });

  it("returns null for non-submitBatch input", () => {
    expect(decodeSubmitBatchInput("0x12345678" as Hex)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(decodeSubmitBatchInput("0x" as Hex)).toBeNull();
  });

  it("returns null for garbage", () => {
    expect(
      decodeSubmitBatchInput("0xdeadbeef" as Hex),
    ).toBeNull();
  });
});

describe("decodeBatchTx with mock client", () => {
  it("decodes a mock submitBatch transaction", async () => {
    // Build inner calldata
    const pad64 = (hex: string) => hex.padStart(64, "0");
    const words: string[] = [];
    words.push(pad64("a0")); // offset
    words.push("9148276900000000000000000000000000000000000000000000000000000001"); // batchId
    words.push(pad64("1a")); // domain=26
    words.push("000000000000000000000000" + "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"); // token
    words.push("000000000000000000000000" + "0077777d7eba4688bdef3e311b846f25870a19b9"); // inner
    words.push(pad64("1")); // count=1
    words.push("000000000000000000000000" + "0000000000000000000000000000000000000001"); // addr
    const neg1m = (BigInt(1) << BigInt(256)) - BigInt(1000000);
    words.push(neg1m.toString(16).padStart(64, "0")); // delta=-1000000

    const calldataBytes = ("0x" + words.join("")) as `0x${string}`;
    const signature = ("0x" + "bb".repeat(65)) as `0x${string}`;

    const txInput = encodeFunctionData({
      abi: SUBMIT_BATCH_ABI,
      args: [calldataBytes, signature],
    });

    const txHash = "0x" + "a".repeat(64);

    // Mock PublicClient
    const mockClient = {
      getTransaction: async () => ({
        hash: txHash as `0x${string}`,
        to: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as `0x${string}`,
        from: "0x0000000000000000000000000000000000000099" as `0x${string}`,
        input: txInput,
        blockNumber: BigInt(12345),
      }),
      getBlock: async () => ({
        timestamp: BigInt(1700000000),
      }),
    };

    const { decodeBatchTx } = await import("../src/decode-batch-tx.js");
    const result = await decodeBatchTx(
      txHash,
      mockClient as unknown as Parameters<typeof decodeBatchTx>[1],
    );

    expect(result).not.toBeNull();
    expect(result!.domain).toBe(26);
    expect(result!.entries).toHaveLength(1);
    expect(result!.entries[0]!.delta).toBe(BigInt(-1000000));
    expect(result!.entries[0]!.usdc).toBe("-1.000000");
    expect(result!.blockNumber).toBe(BigInt(12345));
    expect(result!.blockTimestamp).toBe(1700000000);
    expect(result!.relayer).toBe(
      "0x0000000000000000000000000000000000000099",
    );
    expect(result!.netTransfers).toHaveLength(0); // 1 entry only, no pair
  });
});
