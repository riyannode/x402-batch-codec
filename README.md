# x402-batch-codec

Standalone TypeScript SDK for safe Circle Gateway `submitBatch` evidence on Arc.

The package exposes decoded batch metadata and signed-delta address participation. It does **not** execute payments or create cryptographic attestations.

## Circle Gateway mapping model

Circle Gateway provides an official batch-level `txHash` for each x402 transfer once available. Multiple transfers included in the same batch may share the same `txHash`.

That mapping comes from Circle's off-chain HTTP API. The API response is not a signed attestation, and a Solidity contract cannot directly verify the HTTP response. RPC validation is still required to inspect the actual Arc transaction.

Gateway batch settlement may use net balance deltas. A decoded buyer/seller entry does not prove a unique one-to-one transfer, and exact payment amount attribution is not derived from net deltas.

`resolveX402BatchProof` uses this order:

```text
Circle transfer UUID
  -> official top-level txHash
  -> Arc RPC transaction and receipt validation
  -> submitBatch decoding
  -> optional buyer/seller signed-delta participation checks
```

Timestamp matching is retained only as an explicitly enabled legacy heuristic. It is disabled by default and never replaces a valid official `txHash`.

## Verification levels

`resolveX402BatchProof` returns a `verificationLevel` separate from the Gateway status:

- `unresolved`: no usable official mapping or explicitly enabled fallback candidate exists.
- `official_batch_mapping`: Circle returned a valid official batch `txHash`, but RPC validation or decoding did not succeed. This is an official off-chain mapping, not decoded on-chain evidence.
- `legacy_timestamp_candidate`: the selected hash came only from the explicitly enabled explorer timestamp heuristic, or that candidate could not be decoded.
- `decoded_batch`: the selected transaction passed strict RPC validation and its `submitBatch` calldata was decoded.
- `address_participation`: every supplied expected address matched with the required signed delta direction. This does not prove unique attribution, exact amount attribution, cryptographic inclusion, or a Solidity-verifiable attestation.

Gateway statuses are `received`, `batched`, `confirmed`, `completed`, and `failed`. `received` and `failed` are unresolved. `batched` without a valid official hash is unresolved by default. `batched`, `confirmed`, and `completed` with a valid official hash are processed by hash, not by status alone.

## Install

This package is not published to npm yet. Install directly from GitHub and pin the full commit SHA supplied by your release process:

```bash
npm install github:riyannode/x402-batch-codec#<FULL_COMMIT_SHA>
```

The package supports ESM imports and CommonJS `require()` through its conditional exports.

## Quick start

```typescript
import { resolveX402BatchProof } from "x402-batch-codec";

const evidence = await resolveX402BatchProof({
  settlementId,
  expectedBuyer,
  expectedSeller,
});

console.log(evidence.gatewayStatus);
console.log(evidence.txHash);
console.log(evidence.verificationLevel);
```

### Official mapping available

When Circle returns a valid top-level `txHash`, only that transaction is fetched and decoded. Explorer timestamp discovery is not called.

```typescript
const evidence = await resolveX402BatchProof({
  settlementId,
  expectedBuyer,
  expectedSeller,
});

// evidence.matchedBy === "gateway_txhash_field"
// evidence.officialBatchTxHash === evidence.txHash when the official hash is available
```

### Official mapping exists but RPC fails

The official hash is preserved without being replaced by a timestamp candidate:

```text
verificationLevel: "official_batch_mapping"
matchedBy: "gateway_txhash_field"
txHash: <official Circle txHash>
```

### Official hash not available

The default is unresolved and no explorer request is made:

```text
verificationLevel: "unresolved"
```

### Explicit legacy fallback

```typescript
const evidence = await resolveX402BatchProof({
  settlementId,
  allowLegacyTimestampFallback: true,
});
```

This is heuristic candidate discovery only. Its match field is `legacy_timestamp_candidate` unless expected addresses match after strict decoding, in which case `matchedBy` is `decoded_delta`. It is never an official Circle mapping.

## Strict transaction validation

The high-level resolver defaults to:

- RPC: `https://rpc.testnet.arc.network`
- Gateway Wallet: `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`
- Arc domain: `26`

Decoded evidence requires a transaction that exists, is mined with a block number greater than zero, has a successful receipt, targets the configured Gateway Wallet, uses `submitBatch(bytes,bytes)`, and contains the expected inner Gateway Wallet, domain, token (when configured), valid batch ID, addresses, and signed `int256` deltas.

The reusable lower-level decoder accepts configurable wallet, domain, and token options. Arc defaults are applied only by the high-level resolver.

## Gateway transfer types

The public `GatewayTransferStatus` contains only validated canonical fields:

```typescript
export type GatewayTransferStatusValue =
  | "received"
  | "batched"
  | "confirmed"
  | "completed"
  | "failed";

export type GatewayTransferStatus = {
  id: string;
  status: GatewayTransferStatusValue;
  token: string | null;
  sendingNetwork: string | null;
  recipientNetwork: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  amount: string | null;
  nonce: string | null;
  txHash: `0x${string}` | null;
  createdAt: string | null;
  updatedAt: string | null;
};
```

A returned transfer ID must equal the requested UUID. Unknown status values, malformed IDs, malformed hashes, and unsafe field types do not produce transfer evidence. The complete raw Gateway response is never returned or logged.

## Portable unsigned batch evidence metadata

`encodeBatchProof` produces a strict Base64URL JSON object described as **Portable unsigned batch evidence metadata**.

It is not:

- a cryptographic proof;
- a signed Circle attestation;
- a Solidity-verifiable receipt; or
- an authoritative one-to-one transfer proof.

Safe canonical fields may include `transferId`, `gatewayStatus`, `sendingNetwork`, `recipientNetwork`, `fromAddress`, `toAddress`, `amountAtomic`, `nonce`, and `officialBatchTxHash`. Addresses and hashes are validated; atomic amounts and nonces remain decimal strings. Unknown object keys, non-finite numbers, signatures, private keys, credentials, payment headers, and EIP-712 payloads are rejected recursively.

## API reference

| Function | Description |
|---|---|
| `decodeSubmitBatchInput(txInput)` | Decode outer `submitBatch(bytes,bytes)` input without returning signature bytes. |
| `decodeSubmitBatchCalldataBytes(calldataBytes, options?)` | Validate and decode the fixed Circle inner layout, batch ID, domain, token, Gateway Wallet, and entries. The entries offset must be exactly `0xa0`. |
| `decodeBatchTx(txHash, client, options?)` | Fetch and strictly validate/decode a transaction. |
| `decodeBatchTxWithRpc(txHash, rpcUrl, options?)` | Convenience wrapper for an RPC URL. |
| `inferNetTransfers(entries)` | Pair exact-opposite deltas as a convenience, not unique payment attribution. |
| `buyerInBatch(decoded, address)` | Find a negative signed delta for an address. |
| `sellerInBatch(decoded, address)` | Find a positive signed delta for an address. |
| `findSubmitBatchCandidates(...)` | Explicit legacy explorer candidate discovery with pagination and time limits. |
| `resolveX402BatchProof(opts)` | Resolve a transfer using official Circle `txHash` precedence and optional legacy fallback. |
| `encodeBatchProof(proof)` / `decodeBatchProof(encoded)` | Encode or validate portable unsigned metadata. |

`MatchedBy` values are:

- `gateway_txhash_field` for the official Circle top-level mapping;
- `manual_tx` for an operator-provided hash;
- `decoded_delta` for a legacy explorer candidate with all requested address matches;
- `legacy_timestamp_candidate` for a legacy candidate without successful requested address matching.

## Optional live Arc Testnet check

The live suite is skipped unless a real transfer UUID is supplied:

```bash
RUN_LIVE_ARC_TESTS=1 \
LIVE_X402_TRANSFER_ID=<REAL_TRANSFER_UUID> \
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network \
npm test
```

The live test fetches `GET /v1/x402/transfers/{LIVE_X402_TRANSFER_ID}`, verifies the returned ID, requires the official top-level `txHash`, validates a successful receipt and Gateway Wallet, decodes domain `26`, and checks API-provided buyer/seller participation when addresses are present. It prints only the UUID, official batch hash, status, batch ID, and entry count. If no real UUID is configured, the test remains skipped; no UUID or hash is fabricated.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm pack --dry-run
npm audit
npm audit --omit=dev
```

CI uses Node.js 20 and runs the same package checks. Audit findings are reported separately for production and development dependency trees; this project does not run `npm audit fix --force`.

## License

MIT
