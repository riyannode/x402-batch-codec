import { describe, expect, it } from "vitest";
import { decodeBatchTxWithRpc } from "../src/decode-batch-tx.js";
import { buyerInBatch, sellerInBatch } from "../src/net-transfers.js";
import { isEvmAddress, isEvmTxHash, isUuid } from "../src/guards.js";

const liveTransferId = process.env.LIVE_X402_TRANSFER_ID;
const liveRequested = process.env.RUN_LIVE_ARC_TESTS === "1";
if (liveRequested && !isUuid(liveTransferId)) {
  throw new Error(
    "RUN_LIVE_ARC_TESTS=1 requires a valid LIVE_X402_TRANSFER_ID",
  );
}
const live = liveRequested ? describe : describe.skip;
const gatewayWallet = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const gatewayApiUrl = process.env.GATEWAY_API_URL ?? "https://gateway-api-testnet.circle.com";

live("live Arc Testnet official Gateway mapping", () => {
  it("fetches the transfer UUID, reads top-level txHash, and validates submitBatch", async () => {
    const transferId = process.env.LIVE_X402_TRANSFER_ID;
    expect(isUuid(transferId)).toBe(true);

    const response = await fetch(
      `${gatewayApiUrl}/v1/x402/transfers/${encodeURIComponent(transferId!)}`,
    );
    expect(response.ok).toBe(true);
    const data: unknown = await response.json();
    expect(typeof data).toBe("object");
    expect(data).not.toBeNull();
    const transfer = data as Record<string, unknown>;

    expect(transfer.id).toBe(transferId);
    const officialTxHash = transfer.txHash;
    expect(isEvmTxHash(officialTxHash)).toBe(true);

    const rpcUrl = process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network";
    const decoded = await decodeBatchTxWithRpc(officialTxHash as string, rpcUrl, {
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

    const fromAddress = transfer.fromAddress;
    const toAddress = transfer.toAddress;
    const buyerParticipation = isEvmAddress(fromAddress)
      ? buyerInBatch(decoded!, fromAddress).found
      : false;
    const sellerParticipation = isEvmAddress(toAddress)
      ? sellerInBatch(decoded!, toAddress).found
      : false;

    if (process.env.LIVE_REQUIRE_BUYER_PARTICIPATION === "1") {
      expect(isEvmAddress(fromAddress)).toBe(true);
      expect(buyerParticipation).toBe(true);
    }
    if (process.env.LIVE_REQUIRE_SELLER_PARTICIPATION === "1") {
      expect(isEvmAddress(toAddress)).toBe(true);
      expect(sellerParticipation).toBe(true);
    }

    console.info(`LIVE_X402_TRANSFER_ID=${transferId}`);
    console.info(`official batch txHash=${officialTxHash}`);
    console.info(`Gateway status=${typeof transfer.status === "string" ? transfer.status : "unknown"}`);
    console.info(`decoded batch ID=${decoded!.batchId}`);
    console.info(`entry count=${decoded!.entries.length}`);
    console.info(`buyer participation=${isEvmAddress(fromAddress) ? buyerParticipation : "not-provided"}`);
    console.info(`seller participation=${isEvmAddress(toAddress) ? sellerParticipation : "not-provided"}`);
  }, 30_000);
});
