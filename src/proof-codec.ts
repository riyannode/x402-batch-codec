/**
 * Portable batch evidence metadata codec — base64url JSON, unsigned.
 *
 * The encoded object is not a cryptographic proof, attestation, signature,
 * or smart-contract verification result.
 */

import { isBytes32, isEvmAddress, isEvmTxHash, isUuid } from "./guards.js";
import { safeExplorerUrl } from "./explorer.js";
import type {
  GatewayTransferStatusValue,
  MatchedBy,
  VerificationLevel,
  X402BatchProof,
} from "./types.js";

const UNSAFE_KEYS = new Set([
  "signature",
  "paymentsignature",
  "xpayment",
  "paymentheader",
  "eip712",
  "typeddata",
  "entitysecret",
  "entitysecretciphertext",
  "privatekey",
  "apikey",
  "authorization",
  "walletid",
]);

const VERIFICATION_LEVELS = new Set<VerificationLevel>([
  "unresolved",
  "official_batch_mapping",
  "legacy_timestamp_candidate",
  "decoded_batch",
  "address_participation",
]);
const GATEWAY_STATUSES = new Set<GatewayTransferStatusValue>([
  "received",
  "batched",
  "confirmed",
  "completed",
  "failed",
]);
const MATCHED_BY = new Set<MatchedBy>([
  "gateway_txhash_field",
  "manual_tx",
  "decoded_delta",
  "legacy_timestamp_candidate",
]);
const ALLOWED_KEYS = new Set([
  "v",
  "transferId",
  "settlementId",
  "gatewayStatus",
  "status",
  "verificationLevel",
  "matchedBy",
  "txHash",
  "officialBatchTxHash",
  "explorerUrl",
  "sendingNetwork",
  "recipientNetwork",
  "fromAddress",
  "toAddress",
  "amountAtomic",
  "nonce",
  "batchId",
  "domain",
  "token",
  "gatewayWallet",
  "entriesCount",
  "netTransfersCount",
  "buyerVerified",
  "sellerVerified",
  "buyerEntry",
  "sellerEntry",
  "limitations",
]);

// This is intentionally the schema from the public v1 codec before
// verificationLevel became required. It is decode-only; the encoder below
// always emits the current schema.
const LEGACY_ALLOWED_KEYS = new Set([
  "v",
  "settlementId",
  "status",
  "txHash",
  "explorerUrl",
  "batchId",
  "domain",
  "token",
  "gatewayWallet",
  "entriesCount",
  "netTransfersCount",
  "buyerVerified",
  "sellerVerified",
  "buyerEntry",
  "sellerEntry",
  "matchedBy",
]);
const LEGACY_MATCHED_BY = new Set([
  "decoded_delta",
  "timestamp_candidate",
  "gateway_txhash_field",
  "manual_tx",
]);
const LEGACY_STATUSES = new Set([
  "completed",
  "confirmed",
  "unresolved",
  "gateway_fetch_failed",
]);

type PlainRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is PlainRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function findUnsafeKey(value: unknown, path = "", seen = new WeakSet<object>()): string | null {
  if (value === undefined) return null;
  if (typeof value !== "object") {
    return typeof value === "function" || typeof value === "symbol" || typeof value === "bigint"
      ? (path || "unsupported_value")
      : null;
  }
  if (value === null) return null;
  if (seen.has(value)) return "cyclic_object";
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (value[i] === undefined) return `${path}[${i}]`;
      const found = findUnsafeKey(value[i], `${path}[${i}]`, seen);
      if (found) return found;
    }
    return null;
  }
  if (!isPlainRecord(value)) return "unsupported_object";
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key.toLowerCase())) {
      return path ? `${path}.${key}` : key;
    }
    const found = findUnsafeKey(value[key], path ? `${path}.${key}` : key, seen);
    if (found) return found;
  }
  return null;
}

function validateJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) return value.every(validateJsonValue);
  if (!isPlainRecord(value)) return false;
  return Object.values(value).every(validateJsonValue);
}

function validNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validEntry(value: unknown): value is { address: `0x${string}`; usdc: string } {
  if (!isPlainRecord(value)) return false;
  return (
    Object.keys(value).every((key) => key === "address" || key === "usdc") &&
    isEvmAddress(value["address"]) &&
    typeof value["usdc"] === "string" &&
    value["usdc"].length > 0
  );
}

function validAtomicString(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]+$/.test(value);
}

function validNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasDecodedBatchFields(obj: PlainRecord): boolean {
  return (
    isBytes32(obj["batchId"]) &&
    validNonnegativeInteger(obj["domain"]) &&
    obj["domain"] <= 0xffff_ffff &&
    isEvmAddress(obj["token"]) &&
    isEvmAddress(obj["gatewayWallet"])
  );
}

function hasAnyDecodedBatchField(obj: PlainRecord): boolean {
  return ["batchId", "domain", "token", "gatewayWallet"].some((key) => key in obj);
}

function validateProof(value: unknown): value is X402BatchProof {
  if (!validateJsonValue(value) || !isPlainRecord(value)) return false;
  const obj = value;
  if (!Object.keys(obj).every((key) => ALLOWED_KEYS.has(key))) return false;
  if (obj["v"] !== 1 || !VERIFICATION_LEVELS.has(obj["verificationLevel"] as VerificationLevel)) {
    return false;
  }
  if (!("txHash" in obj) || !("explorerUrl" in obj)) return false;
  const txHash = obj["txHash"];
  const officialHash = obj["officialBatchTxHash"];
  if (txHash !== null && !isEvmTxHash(txHash)) return false;
  if (officialHash !== undefined && !isEvmTxHash(officialHash)) return false;
  if (obj["explorerUrl"] !== null && safeExplorerUrl(obj["explorerUrl"]) === null) return false;
  if (!validNonnegativeInteger(obj["entriesCount"])) return false;
  if (!validNonnegativeInteger(obj["netTransfersCount"])) return false;

  if (obj["transferId"] !== undefined && !isUuid(obj["transferId"])) return false;
  if (obj["settlementId"] !== undefined && !isUuid(obj["settlementId"])) return false;
  if (
    obj["gatewayStatus"] !== undefined &&
    !GATEWAY_STATUSES.has(obj["gatewayStatus"] as GatewayTransferStatusValue)
  ) return false;
  if (obj["status"] !== undefined && typeof obj["status"] !== "string") return false;
  if (obj["matchedBy"] !== undefined && !MATCHED_BY.has(obj["matchedBy"] as MatchedBy)) return false;
  if (obj["sendingNetwork"] !== undefined && !validNonemptyString(obj["sendingNetwork"])) return false;
  if (obj["recipientNetwork"] !== undefined && !validNonemptyString(obj["recipientNetwork"])) return false;
  if (obj["fromAddress"] !== undefined && !isEvmAddress(obj["fromAddress"])) return false;
  if (obj["toAddress"] !== undefined && !isEvmAddress(obj["toAddress"])) return false;
  if (obj["amountAtomic"] !== undefined && !validAtomicString(obj["amountAtomic"])) return false;
  if (obj["nonce"] !== undefined && !isBytes32(obj["nonce"])) return false;
  if (obj["batchId"] !== undefined && !isBytes32(obj["batchId"])) return false;
  if (obj["domain"] !== undefined && (!validNonnegativeInteger(obj["domain"]) || obj["domain"] > 0xffff_ffff)) return false;
  if (obj["token"] !== undefined && !isEvmAddress(obj["token"])) return false;
  if (obj["gatewayWallet"] !== undefined && !isEvmAddress(obj["gatewayWallet"])) return false;
  if (obj["buyerVerified"] !== undefined && typeof obj["buyerVerified"] !== "boolean") return false;
  if (obj["sellerVerified"] !== undefined && typeof obj["sellerVerified"] !== "boolean") return false;
  if (obj["buyerEntry"] !== undefined && !validEntry(obj["buyerEntry"])) return false;
  if (obj["sellerEntry"] !== undefined && !validEntry(obj["sellerEntry"])) return false;
  if (
    obj["limitations"] !== undefined &&
    (!Array.isArray(obj["limitations"]) || !obj["limitations"].every((x) => typeof x === "string"))
  ) return false;

  if (
    obj["transferId"] !== undefined &&
    obj["settlementId"] !== undefined &&
    obj["transferId"] !== obj["settlementId"]
  ) return false;
  if (
    obj["gatewayStatus"] !== undefined &&
    obj["status"] !== undefined &&
    obj["gatewayStatus"] !== obj["status"]
  ) return false;
  if (officialHash !== undefined && (txHash === null || txHash !== officialHash)) return false;

  const level = obj["verificationLevel"] as VerificationLevel;
  const matchedBy = obj["matchedBy"] as MatchedBy | undefined;
  const decodedFieldKeys = ["batchId", "domain", "token", "gatewayWallet"];
  switch (level) {
    case "unresolved":
      if (obj["entriesCount"] !== 0 || obj["netTransfersCount"] !== 0) return false;
      if (hasAnyDecodedBatchField(obj)) return false;
      if (officialHash !== undefined) return false;
      if (txHash !== null && matchedBy !== "manual_tx") return false;
      if (matchedBy !== undefined && matchedBy !== "manual_tx") return false;
      if (obj["buyerVerified"] !== undefined || obj["sellerVerified"] !== undefined) return false;
      if (obj["buyerEntry"] !== undefined || obj["sellerEntry"] !== undefined) return false;
      break;
    case "official_batch_mapping":
      if (txHash === null || officialHash === undefined || officialHash !== txHash) return false;
      if (matchedBy !== "gateway_txhash_field") return false;
      if (obj["entriesCount"] !== 0 || obj["netTransfersCount"] !== 0) return false;
      if (decodedFieldKeys.some((key) => key in obj)) return false;
      if (obj["buyerVerified"] !== undefined || obj["sellerVerified"] !== undefined) return false;
      if (obj["buyerEntry"] !== undefined || obj["sellerEntry"] !== undefined) return false;
      break;
    case "legacy_timestamp_candidate":
      if (txHash === null || matchedBy !== "legacy_timestamp_candidate") return false;
      if (obj["entriesCount"] !== 0 || obj["netTransfersCount"] !== 0) return false;
      if (decodedFieldKeys.some((key) => key in obj)) return false;
      if (officialHash !== undefined) return false;
      if (obj["buyerVerified"] !== undefined || obj["sellerVerified"] !== undefined) return false;
      if (obj["buyerEntry"] !== undefined || obj["sellerEntry"] !== undefined) return false;
      break;
    case "decoded_batch":
      if (txHash === null || !hasDecodedBatchFields(obj)) return false;
      if (matchedBy === "gateway_txhash_field") {
        if (officialHash === undefined || officialHash !== txHash) return false;
      } else if (matchedBy === "manual_tx") {
        if (officialHash !== undefined) return false;
      } else if (matchedBy !== undefined) {
        return false;
      }
      if (officialHash !== undefined && matchedBy !== "gateway_txhash_field") return false;
      if (obj["buyerEntry"] !== undefined && obj["buyerVerified"] !== true) return false;
      if (obj["sellerEntry"] !== undefined && obj["sellerVerified"] !== true) return false;
      break;
    case "address_participation":
      if (txHash === null || !hasDecodedBatchFields(obj)) return false;
      if (matchedBy !== "gateway_txhash_field" && matchedBy !== "manual_tx" && matchedBy !== "decoded_delta") return false;
      if (matchedBy === "gateway_txhash_field" && (officialHash === undefined || officialHash !== txHash)) return false;
      if (matchedBy !== "gateway_txhash_field" && officialHash !== undefined) return false;
      if (matchedBy === "decoded_delta" && officialHash !== undefined) return false;
      const buyerPresent = obj["buyerVerified"] !== undefined;
      const sellerPresent = obj["sellerVerified"] !== undefined;
      if (!buyerPresent && !sellerPresent) return false;
      if (buyerPresent && obj["buyerVerified"] !== true) return false;
      if (sellerPresent && obj["sellerVerified"] !== true) return false;
      if (obj["buyerVerified"] === true && obj["buyerEntry"] === undefined) return false;
      if (obj["sellerVerified"] === true && obj["sellerEntry"] === undefined) return false;
      if (obj["buyerEntry"] !== undefined && obj["buyerVerified"] !== true) return false;
      if (obj["sellerEntry"] !== undefined && obj["sellerVerified"] !== true) return false;
      break;
  }
  return true;
}

function validateLegacyProof(value: unknown): value is PlainRecord {
  if (!validateJsonValue(value) || !isPlainRecord(value)) return false;
  if (Object.keys(value).some((key) => !LEGACY_ALLOWED_KEYS.has(key))) return false;
  if (value["v"] !== 1 || "verificationLevel" in value) return false;
  if (!("txHash" in value) || !("explorerUrl" in value) || !("entriesCount" in value) || !("netTransfersCount" in value)) return false;
  if (value["txHash"] !== null && !isEvmTxHash(value["txHash"])) return false;
  if (value["explorerUrl"] !== null && safeExplorerUrl(value["explorerUrl"]) === null) return false;
  if (!validNonnegativeInteger(value["entriesCount"]) || !validNonnegativeInteger(value["netTransfersCount"])) return false;
  if (value["settlementId"] !== undefined && !isUuid(value["settlementId"])) return false;
  if (value["status"] !== undefined && (typeof value["status"] !== "string" || !LEGACY_STATUSES.has(value["status"]))) return false;
  if (value["matchedBy"] !== undefined && (typeof value["matchedBy"] !== "string" || !LEGACY_MATCHED_BY.has(value["matchedBy"]))) return false;
  if (value["batchId"] !== undefined && !isBytes32(value["batchId"])) return false;
  if (value["domain"] !== undefined && (!validNonnegativeInteger(value["domain"]) || value["domain"] > 0xffff_ffff)) return false;
  if (value["token"] !== undefined && !isEvmAddress(value["token"])) return false;
  if (value["gatewayWallet"] !== undefined && !isEvmAddress(value["gatewayWallet"])) return false;
  if (value["buyerVerified"] !== undefined && typeof value["buyerVerified"] !== "boolean") return false;
  if (value["sellerVerified"] !== undefined && typeof value["sellerVerified"] !== "boolean") return false;
  if (value["buyerEntry"] !== undefined && !validEntry(value["buyerEntry"])) return false;
  if (value["sellerEntry"] !== undefined && !validEntry(value["sellerEntry"])) return false;
  if (value["buyerVerified"] === true && value["buyerEntry"] === undefined) return false;
  if (value["sellerVerified"] === true && value["sellerEntry"] === undefined) return false;
  return true;
}

function preserveConsistentLegacyParticipation(base: PlainRecord, legacy: PlainRecord): void {
  for (const role of ["buyer", "seller"] as const) {
    const verifiedKey = `${role}Verified`;
    const entryKey = `${role}Entry`;
    const verified = legacy[verifiedKey];

    if (verified === true) {
      base[verifiedKey] = true;
      // validateLegacyProof already requires the entry for a true flag.
      base[entryKey] = legacy[entryKey];
    } else if (verified === false) {
      base[verifiedKey] = false;
      // An entry without a matching positive verification flag is
      // contradictory evidence, so it is deliberately not migrated.
    }
  }
}

function migrateLegacyProof(legacy: PlainRecord): X402BatchProof | null {
  if (!validateLegacyProof(legacy)) return null;
  const txHash = legacy["txHash"] as `0x${string}` | null;
  const base: PlainRecord = {
    v: 1,
    ...(legacy["settlementId"] !== undefined ? { settlementId: legacy["settlementId"] } : {}),
    ...(legacy["status"] !== undefined ? { status: legacy["status"] } : {}),
    txHash,
    explorerUrl: legacy["explorerUrl"],
    entriesCount: legacy["entriesCount"],
    netTransfersCount: legacy["netTransfersCount"],
  };
  const legacyStatus = legacy["status"];
  if (typeof legacyStatus === "string" && GATEWAY_STATUSES.has(legacyStatus as GatewayTransferStatusValue)) {
    base["gatewayStatus"] = legacyStatus;
  }

  const oldMatchedBy = legacy["matchedBy"];
  const complete = hasDecodedBatchFields(legacy);
  const participation =
    complete &&
    (legacy["buyerVerified"] === true || legacy["sellerVerified"] === true) &&
    (legacy["buyerVerified"] === undefined || legacy["buyerVerified"] === true) &&
    (legacy["sellerVerified"] === undefined || legacy["sellerVerified"] === true) &&
    (legacy["buyerVerified"] !== true || legacy["buyerEntry"] !== undefined) &&
    (legacy["sellerVerified"] !== true || legacy["sellerEntry"] !== undefined);

  if (txHash === null) {
    base["verificationLevel"] = "unresolved";
    base["explorerUrl"] = null;
  } else if (oldMatchedBy === "timestamp_candidate") {
    if (complete) {
      Object.assign(base, {
        batchId: legacy["batchId"],
        domain: legacy["domain"],
        token: legacy["token"],
        gatewayWallet: legacy["gatewayWallet"],
        verificationLevel: "decoded_batch",
      });
      preserveConsistentLegacyParticipation(base, legacy);
    } else if (
      legacy["entriesCount"] === 0 &&
      legacy["netTransfersCount"] === 0 &&
      !hasAnyDecodedBatchField(legacy)
    ) {
      base["verificationLevel"] = "legacy_timestamp_candidate";
      base["matchedBy"] = "legacy_timestamp_candidate";
    } else {
      // Do not turn contradictory legacy metadata into a timestamp-only proof.
      return null;
    }
  } else if (oldMatchedBy === "gateway_txhash_field") {
    if (complete) {
      Object.assign(base, {
        batchId: legacy["batchId"],
        domain: legacy["domain"],
        token: legacy["token"],
        gatewayWallet: legacy["gatewayWallet"],
        verificationLevel: "decoded_batch",
        matchedBy: "gateway_txhash_field",
        officialBatchTxHash: txHash,
      });
    } else {
      Object.assign(base, {
        verificationLevel: "official_batch_mapping",
        matchedBy: "gateway_txhash_field",
        officialBatchTxHash: txHash,
      });
    }
  } else if (oldMatchedBy === "decoded_delta") {
    if (participation) {
      Object.assign(base, {
        batchId: legacy["batchId"],
        domain: legacy["domain"],
        token: legacy["token"],
        gatewayWallet: legacy["gatewayWallet"],
        verificationLevel: "address_participation",
        matchedBy: "decoded_delta",
        ...(legacy["buyerVerified"] !== undefined ? { buyerVerified: legacy["buyerVerified"] } : {}),
        ...(legacy["sellerVerified"] !== undefined ? { sellerVerified: legacy["sellerVerified"] } : {}),
        ...(legacy["buyerEntry"] !== undefined ? { buyerEntry: legacy["buyerEntry"] } : {}),
        ...(legacy["sellerEntry"] !== undefined ? { sellerEntry: legacy["sellerEntry"] } : {}),
      });
    } else if (complete) {
      Object.assign(base, {
        batchId: legacy["batchId"],
        domain: legacy["domain"],
        token: legacy["token"],
        gatewayWallet: legacy["gatewayWallet"],
        verificationLevel: "decoded_batch",
      });
    } else {
      base["verificationLevel"] = "unresolved";
      base["explorerUrl"] = null;
    }
  } else if (oldMatchedBy === "manual_tx") {
    if (complete) {
      Object.assign(base, {
        batchId: legacy["batchId"],
        domain: legacy["domain"],
        token: legacy["token"],
        gatewayWallet: legacy["gatewayWallet"],
        verificationLevel: "decoded_batch",
        matchedBy: "manual_tx",
      });
    } else {
      Object.assign(base, { verificationLevel: "unresolved", matchedBy: "manual_tx" });
    }
  } else if (complete) {
    Object.assign(base, {
      batchId: legacy["batchId"],
      domain: legacy["domain"],
      token: legacy["token"],
      gatewayWallet: legacy["gatewayWallet"],
      verificationLevel: "decoded_batch",
    });
  } else {
    base["verificationLevel"] = "unresolved";
    base["explorerUrl"] = null;
  }

  if (base["verificationLevel"] === "decoded_batch" && oldMatchedBy !== "decoded_delta" && oldMatchedBy !== "timestamp_candidate") {
    for (const key of ["buyerVerified", "sellerVerified", "buyerEntry", "sellerEntry"]) {
      if (legacy[key] !== undefined) base[key] = legacy[key];
    }
  }
  if (base["verificationLevel"] === "address_participation") {
    // fields were copied above
  }
  return validateProof(base) ? base : null;
}

function encodeJson(proof: unknown): string {
  const json = JSON.stringify(proof);
  if (typeof json !== "string") throw new Error("Proof could not be serialized");
  return json;
}

/** Encode portable batch evidence metadata as a strict base64url JSON object. */
export function encodeBatchProof(proof: X402BatchProof): string {
  if (proof?.v !== 1) throw new Error(`Unsupported proof version: ${proof?.v}`);
  const unsafe = findUnsafeKey(proof);
  if (unsafe) throw new Error(`Proof contains unsafe field: ${unsafe}`);
  let json: string;
  try {
    json = encodeJson(proof);
  } catch {
    throw new Error("Invalid portable batch evidence metadata");
  }
  let normalized: unknown;
  try {
    normalized = JSON.parse(json);
  } catch {
    throw new Error("Invalid portable batch evidence metadata");
  }
  if (findUnsafeKey(normalized) || !validateProof(normalized)) {
    throw new Error("Invalid portable batch evidence metadata");
  }
  return Buffer.from(json, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Decode and validate portable batch evidence metadata. */
export function decodeBatchProof(encoded: string): X402BatchProof | null {
  try {
    if (typeof encoded !== "string" || !encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
      return null;
    }
    let b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const parsed: unknown = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
    if (findUnsafeKey(parsed)) return null;
    if (validateProof(parsed)) return parsed;
    if (!isPlainRecord(parsed) || parsed["v"] !== 1 || "verificationLevel" in parsed) return null;
    const migrated = migrateLegacyProof(parsed);
    return migrated && validateProof(migrated) ? migrated : null;
  } catch {
    return null;
  }
}
