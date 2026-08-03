import { describe, expect, it } from "vitest";
import { decodeBatchTxWithRpc } from "../src/decode-batch-tx.js";
import { buyerInBatch, sellerInBatch } from "../src/net-transfers.js";
import { isEvmAddress, isEvmTxHash } from "../src/guards.js";

const liveEnabled = process.env.RUN_LIVE_ARC_TESTS === "1";
const live = liveEnabled ? describe : describe.skip;
const gatewayWallet = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

live("live Arc Testnet submitBatch verification", () => {
  it("fetches and validates a pinned transaction supplied by the operator", async () => {
    const txHash = process.env.LIVE_BATCH_TX_HASH;
    if (!isEvmTxHash(txHash)) {
      throw new Error("RUN_LIVE_ARC_TESTS=1 requires a real LIVE_BATCH_TX_HASH");
    }
    const rpcUrl = process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network";
    const decoded = await decodeBatchTxWithRpc(txHash, rpcUrl, {
      requireReceipt: true,
      expectedGatewayWallet: gatewayWallet,
      expectedDomain: 26,
    });
    expect(decoded).not.toBeNull();
    expect(decoded!.contract.toLowerCase()).toBe(gatewayWallet.toLowerCase());
    expect(decoded!.innerContract.toLowerCase()).toBe(gatewayWallet.toLowerCase());
    expect(decoded!.domain).toBe(26);
    expect(decoded!.batchId).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(decoded!.entries.length).toBeGreaterThan(0);
    expect(decoded!.entries.every((entry) => isEvmAddress(entry.address))).toBe(true);
    expect(decoded!.entries.every((entry) => typeof entry.delta === "bigint")).toBe(true);

    const expectedBuyer = process.env.LIVE_EXPECTED_BUYER;
    const expectedSeller = process.env.LIVE_EXPECTED_SELLER;
    if (expectedBuyer) {
      expect(isEvmAddress(expectedBuyer)).toBe(true);
      expect(buyerInBatch(decoded!, expectedBuyer).found).toBe(true);
    }
    if (expectedSeller) {
      expect(isEvmAddress(expectedSeller)).toBe(true);
      expect(sellerInBatch(decoded!, expectedSeller).found).toBe(true);
    }
  }, 30_000);
});
