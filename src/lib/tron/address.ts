import { createHash } from "node:crypto";

/**
 * TRON (mainnet) address validation with full Base58Check verification.
 * A TRON address is Base58Check of 21 bytes: 0x41 + 20-byte account id,
 * 34 characters starting with "T". Server-only (uses node:crypto).
 */

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Official Tether USDT TRC20 contract on TRON mainnet (6 decimals). */
export const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
export const USDT_DECIMALS = 6;

function sha256(data: Uint8Array): Uint8Array {
  return createHash("sha256").update(data).digest();
}

function base58Decode(text: string): Uint8Array | null {
  let num = BigInt(0);
  for (const ch of text) {
    const idx = BASE58.indexOf(ch);
    if (idx < 0) return null;
    num = num * BigInt(58) + BigInt(idx);
  }
  const bytes: number[] = [];
  while (num > BigInt(0)) {
    bytes.unshift(Number(num % BigInt(256)));
    num /= BigInt(256);
  }
  for (const ch of text) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export type TronAddressCheck =
  | { valid: true; address: string; hex: string }
  | { valid: false; reason: string };

export function validateTronAddress(input: string): TronAddressCheck {
  const address = (input ?? "").trim();
  if (!address) return { valid: false, reason: "Address is empty" };
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
    return { valid: false, reason: "A TRON (TRC20) address has 34 characters and starts with T" };
  }
  const raw = base58Decode(address);
  if (!raw || raw.length !== 25 || raw[0] !== 0x41) return { valid: false, reason: "Not a TRON mainnet address" };
  const payload = raw.slice(0, 21);
  const check = sha256(sha256(payload)).slice(0, 4);
  if (!check.every((b, i) => b === raw[21 + i])) return { valid: false, reason: "Checksum mismatch" };
  const hex = Array.from(payload, (b) => b.toString(16).padStart(2, "0")).join("");
  return { valid: true, address, hex };
}

/** 20-byte account id (hex, no 0x41 prefix) of a valid TRON address, or null. */
export function tronAccountHex(address: string): string | null {
  const check = validateTronAddress(address);
  return check.valid ? check.hex.slice(2) : null;
}
