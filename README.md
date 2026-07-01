# x402-batch-codec

Standalone TypeScript SDK for decoding and verifying Circle Gateway x402 `submitBatch` transactions on Arc.

## What this does

- Decode `submitBatch(bytes calldataBytes, bytes signature)` calldata
- Extract batch entries (address + signed int256 delta) from inner calldata layout
- Infer net transfers by pairing exact-opposite deltas
- Verify buyer/seller presence in a batch via decoded delta evidence
- Encode/decode safe proof objects as base64url JSON
- Resolve settlement UUID → on-chain batch tx via Arc explorer (optional adapter)

## What this does NOT do

- **Does not execute payments.** No wallet signing, no x402 challenge handling.
- **Does not sign anything.** No EIP-712, no private keys, no DCW integration.
- **Does not require Circle API keys** for core codec functions.
- **Does not expose raw payment signatures**, `x-payment` headers, EIP-712 payloads, or Gateway responses.
- **Does not include** Next.js, Supabase, React, or any framework-specific code.

> PR1 verifies buyer/seller presence via decoded batch deltas. Amount verification is intentionally not included yet.

## Install

This package is not published to npm yet. Install directly from GitHub:

```bash
npm install github:riyannode/x402-batch-codec
```

For reproducible installs, pin a commit:

```bash
npm install github:riyannode/x402-batch-codec#eef37cbe93d174124b5691c0402d12327d317579
```

## Quick Start

```typescript
import {
  decodeSubmitBatchCalldataBytes,
  decodeBatchTxWithRpc,
  inferNetTransfers,
  buyerInBatch,
  sellerInBatch,
  encodeBatchProof,
  decodeBatchProof,
  resolveX402BatchProof,
} from "x402-batch-codec";

// Decode inner calldata (no RPC needed)
const inner = decodeSubmitBatchCalldataBytes(calldataBytes);
if (inner) {
  console.log(`Batch ${inner.batchId}, domain ${inner.domain}`);
  console.log(`${inner.entries.length} entries`);

  const transfers = inferNetTransfers(inner.entries);
  console.log(`${transfers.length} net transfers`);
}

// Decode a full on-chain tx (needs RPC)
const decoded = await decodeBatchTxWithRpc(txHash, "https://rpc.testnet.arc.network");
if (decoded) {
  const buyer = buyerInBatch(decoded, "0xBuyerAddress...");
  console.log(`Buyer verified: ${buyer.found}`);
}

// Encode a safe proof (base64url JSON)
const proof = {
  v: 1,
  txHash: "0xabc...",
  explorerUrl: "https://testnet.arcscan.app/tx/0xabc...",
  entriesCount: 39,
  netTransfersCount: 39,
  buyerVerified: true,
  matchedBy: "decoded_delta" as const,
};
const encoded = encodeBatchProof(proof);
const decoded = decodeBatchProof(encoded);
```

## API Reference

### Core Codec (no Circle API needed)

| Function | Description |
|----------|-------------|
| `decodeSubmitBatchInput(txInput)` | Decode outer `submitBatch(bytes,bytes)` input → calldataBytes + signature metadata |
| `decodeSubmitBatchCalldataBytes(calldataBytes)` | Decode inner calldata layout → batchId, domain, token, entries |
| `decodeBatchTx(txHash, client)` | Fetch tx + decode + enrich with block metadata |
| `decodeBatchTxWithRpc(txHash, rpcUrl)` | Convenience wrapper that creates a PublicClient |
| `inferNetTransfers(entries)` | Pair exact-opposite deltas → net transfers |
| `buyerInBatch(decoded, address)` | Find address with negative delta (buyer) |
| `sellerInBatch(decoded, address)` | Find address with positive delta (seller) |
| `formatSignedUsdc(delta)` | Format bigint → human-readable USDC string |
| `isEvmTxHash(value)` | Guard: valid `0x` + 64 hex chars |
| `isUuid(value)` / `isSettlementId(value)` | Guard: valid UUID |
| `buildArcExplorerTxUrl(hash, base?)` | Build explorer URL from tx hash |
| `safeExplorerUrl(url, allowedHosts?)` | Validate explorer URL against allowlist |
| `encodeBatchProof(proof)` | Encode proof → base64url JSON |
| `decodeBatchProof(encoded)` | Decode base64url → proof object |
| `redactUnsafePaymentText(text)` | Strip sensitive payment data from text |

### Optional Resolver Adapter (calls Circle Gateway + Arc explorer)

| Function | Description |
|----------|-------------|
| `resolveX402BatchProof(opts)` | Settlement UUID → verified batch proof |
| `findNearestSubmitBatch(base, wallet, updatedAtMs, maxPages?)` | Scan Arc explorer for submitBatch candidate |

## Security Model

### Proof = decoded delta evidence, not timestamp

Timestamp matching (used by the resolver adapter) is **candidate discovery only**. It narrows the search space. The actual proof signal is **decoded buyer/seller delta evidence**: does the expected buyer address appear with a negative delta in the batch entries? Does the expected seller appear with a positive delta?

### Recursive unsafe field rejection

`encodeBatchProof` and `decodeBatchProof` recursively scan the entire object tree for unsafe field names:

`signature`, `paymentSignature`, `xPayment`, `paymentHeader`, `eip712`, `typedData`, `entitySecret`, `entitySecretCiphertext`, `privateKey`, `apiKey`, `authorization`, `walletId`

Any match → encode throws, decode returns null.

### Explorer URL allowlist

`safeExplorerUrl` validates against a configurable allowlist. Default: `testnet.arcscan.app`, `arc-testnet.blockscout.com`, `arcscan.app`, `arc.blockscout.com`.

## License

MIT
