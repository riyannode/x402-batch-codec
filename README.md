# x402-batch-codec

Standalone TypeScript SDK for **decoded on-chain batch evidence and buyer/seller address participation evidence for Circle Gateway `submitBatch` transactions on Arc**.

The package name and repository name remain `x402-batch-codec`.

## What this does

- Decode Circle Gateway `submitBatch(bytes,bytes)` calldata.
- Extract batch entries and signed int256 balance deltas.
- Infer exact-opposite net transfers as a convenience utility.
- Decode and validate mined Arc transactions through a caller-controlled RPC.
- Resolve timestamp candidates and, when strict RPC context checks pass, return decoded batch evidence.
- Report buyer/seller signed-delta address participation in a netted batch.
- Encode portable batch evidence metadata as unsigned Base64URL JSON.

## What this does not claim

- Circle Gateway transfer status is canonical for the transfer UUID; it is kept separate from resolver verification status.
- Timestamp matching is candidate discovery only and is never presented as verified settlement inclusion.
- Buyer/seller delta presence proves address participation in a netted batch. It does not prove a unique buyer-to-seller x402 transfer.
- Exact payment amount attribution is not implemented.
- Gateway batches may contain netted balance deltas.
- Base64URL evidence objects are unsigned portable metadata, not cryptographic proofs or attestations.
- This SDK does not provide Solidity or smart-contract verification.
- This SDK does not assume an official Circle transfer UUID-to-batch transaction mapping exists.
- This SDK does not execute payments, sign x402 payloads, or expose raw signatures, payment headers, EIP-712 payloads, secrets, API credentials, or wallet identifiers.

## Verification levels

`resolveX402BatchProof` returns an explicit `verificationLevel`:

- `unresolved`: no usable batch transaction was found.
- `timestamp_candidate`: a possible `submitBatch` transaction was found by timing, but RPC decoding/validation did not succeed.
- `decoded_batch`: the transaction was fetched, mined, receipt-successful, context-validated, and decoded.
- `address_participation`: decoded evidence additionally found the supplied expected buyer and/or seller with the correct signed delta direction. When both are supplied, both must match for this strongest level.

`gatewayStatus` preserves Circle's actual transfer status. It is not overwritten with `completed`. The legacy `status` field remains for compatibility but new consumers should use `gatewayStatus` and `verificationLevel`.

## Install

This package is not published to npm yet. Install directly from GitHub and pin the full commit SHA supplied by your release process:

```bash
npm install github:riyannode/x402-batch-codec#<FULL_COMMIT_SHA>
```

## Quick start

```typescript
import {
  decodeSubmitBatchCalldataBytes,
  decodeBatchTxWithRpc,
  buyerInBatch,
  encodeBatchProof,
  decodeBatchProof,
  resolveX402BatchProof,
} from "x402-batch-codec";

const inner = decodeSubmitBatchCalldataBytes(calldataBytes);
if (inner) {
  console.log(`Batch ${inner.batchId}, domain ${inner.domain}`);
}

const decoded = await decodeBatchTxWithRpc(
  txHash,
  "https://rpc.testnet.arc.network",
  {
    requireReceipt: true,
    expectedGatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    expectedDomain: 26,
  },
);
if (decoded) {
  console.log(buyerInBatch(decoded, buyerAddress).found);
}

const evidence = await resolveX402BatchProof({
  settlementId,
  expectedBuyer: buyerAddress,
  expectedSeller: sellerAddress,
  // Defaults: Arc Testnet RPC, Arc Gateway wallet, and domain 26.
});

const encoded = encodeBatchProof({
  v: 1,
  verificationLevel: "decoded_batch",
  txHash: evidence.txHash,
  explorerUrl: evidence.explorerUrl,
  entriesCount: evidence.entriesCount,
  netTransfersCount: evidence.netTransfersCount,
  limitations: evidence.limitations,
});
const portableMetadata = decodeBatchProof(encoded);
```

## API reference

### Core codec

| Function | Description |
|---|---|
| `decodeSubmitBatchInput(txInput)` | Decode outer `submitBatch(bytes,bytes)` input without returning signature bytes. |
| `decodeSubmitBatchCalldataBytes(calldataBytes, options?)` | Validate and decode inner layout, batch ID, domain, token, Gateway wallet, and entries. |
| `decodeBatchTx(txHash, client, options?)` | Fetch and decode a transaction; strict options validate receipt and context. |
| `decodeBatchTxWithRpc(txHash, rpcUrl, options?)` | Convenience wrapper for an RPC URL. |
| `inferNetTransfers(entries)` | Pair exact-opposite deltas as a convenience, not unique payment attribution. |
| `buyerInBatch(decoded, address)` | Find a negative signed delta for an address. |
| `sellerInBatch(decoded, address)` | Find a positive signed delta for an address. |
| `formatSignedUsdc(delta)` | Format signed USDC atomic units using bigint arithmetic. |

### Candidate discovery and resolver

| Function | Description |
|---|---|
| `findSubmitBatchCandidates(base, wallet, updatedAtMs, maxPages?, maxDistanceMs?)` | Paginate validated explorer responses and return structured timestamp candidates sorted by distance. |
| `findNearestSubmitBatch(...)` | Backward-compatible helper returning only the nearest candidate hash. |
| `resolveX402BatchProof(opts)` | Fetch safe Gateway status, inspect Gateway-provided hashes, discover candidates, strictly decode through RPC, and return portable batch evidence metadata. |

Resolver defaults:

- RPC: `https://rpc.testnet.arc.network`
- Expected Gateway wallet: `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`
- Expected Arc domain: `26`
- Explorer candidate window: one hour unless `maxDistanceMs` is configured.

Strict transaction validation requires a mined transaction with a positive block number, a successful receipt, the expected Gateway wallet as `tx.to`, outer `submitBatch` input, the expected inner Gateway wallet, expected domain, and configured expected token.

## Portable evidence metadata safety

`encodeBatchProof` and `decodeBatchProof` recursively reject unsafe fields including signatures, payment headers, EIP-712 payloads, authorization objects, API keys, wallet IDs, private keys, and entity secrets. They also validate the exact public schema, enum values, finite nonnegative counts, EVM hashes/addresses, safe explorer URLs, and JSON-compatible values.

## Optional live Arc Testnet check

The live suite is skipped unless explicitly enabled:

```bash
RUN_LIVE_ARC_TESTS=1 \
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network \
LIVE_BATCH_TX_HASH=<real-pinned-Arc-Testnet-submitBatch-hash> \
npm test
```

No live transaction was used by the default deterministic test run. Do not replace the placeholder with a fabricated hash; supply a real pinned Arc Testnet transaction when enabling this suite. Optional `LIVE_EXPECTED_BUYER` and `LIVE_EXPECTED_SELLER` values exercise signed-delta lookups.

## License

MIT
