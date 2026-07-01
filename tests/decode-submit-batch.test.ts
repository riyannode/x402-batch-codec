import { describe, it, expect } from "vitest";
import { decodeSubmitBatchCalldataBytes } from "../src/decode-submit-batch.js";

describe("decodeSubmitBatchCalldataBytes", () => {
  // Fixture: manually constructed inner calldata with 2 entries
  // Layout: offset(0xa0) | batchId | domain(26) | token | innerContract | count(2) | entries
  function buildFixture(): `0x${string}` {
    const pad64 = (hex: string) => hex.padStart(64, "0");
    const words: string[] = [];

    // word 0: offset pointer (0xa0 = 160)
    words.push(pad64("a0"));
    // word 1: batchId
    words.push("9148276900000000000000000000000000000000000000000000000000000001");
    // word 2: domain = 26 (Arc)
    words.push(pad64("1a"));
    // word 3: token address (padded to 32 bytes)
    words.push(
      "000000000000000000000000" + "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    );
    // word 4: inner contract / gateway wallet
    words.push(
      "000000000000000000000000" + "0077777d7eba4688bdef3e311b846f25870a19b9",
    );
    // word 5: entries count = 2
    words.push(pad64("2"));

    // Entry 0: address = 0x0000...0001, delta = -1000000 (negative, buyer)
    words.push(
      "000000000000000000000000" + "0000000000000000000000000000000000000001",
    );
    // int256(-1000000) in two's complement 32-byte hex
    const neg1m = (BigInt(1) << BigInt(256)) - BigInt(1000000);
    words.push(neg1m.toString(16).padStart(64, "0"));

    // Entry 1: address = 0x0000...0002, delta = +1000000 (positive, seller)
    words.push(
      "000000000000000000000000" + "0000000000000000000000000000000000000002",
    );
    words.push(pad64("f4240")); // 1000000 hex

    return `0x${words.join("")}` as `0x${string}`;
  }

  it("decodes valid fixture", () => {
    const result = decodeSubmitBatchCalldataBytes(buildFixture());
    expect(result).not.toBeNull();
    expect(result!.domain).toBe(26);
    expect(result!.batchId).toBe(
      "0x9148276900000000000000000000000000000000000000000000000000000001",
    );
    expect(result!.token.toLowerCase()).toBe(
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    );
    expect(result!.innerContract.toLowerCase()).toBe(
      "0x0077777d7eba4688bdef3e311b846f25870a19b9",
    );
    expect(result!.entries).toHaveLength(2);
    expect(result!.entries[0]!.delta).toBe(BigInt(-1000000));
    expect(result!.entries[0]!.usdc).toBe("-1.000000");
    expect(result!.entries[1]!.delta).toBe(BigInt(1000000));
    expect(result!.entries[1]!.usdc).toBe("1.000000");
  });

  it("returns null for too-short input", () => {
    expect(decodeSubmitBatchCalldataBytes("0x1234")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(decodeSubmitBatchCalldataBytes("0x" as `0x${string}`)).toBeNull();
  });

  it("returns null for garbage hex", () => {
    expect(
      decodeSubmitBatchCalldataBytes(
        ("0x" + "zz".repeat(300)) as `0x${string}`,
      ),
    ).toBeNull();
  });
});
