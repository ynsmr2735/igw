import { createHash } from "node:crypto";

/**
 * Bitcoin MAINNET address validation with full checksum verification:
 * - P2PKH "1…" and P2SH "3…" (Base58Check, version bytes 0x00 / 0x05)
 * - SegWit v0 "bc1q…" (Bech32, BIP173) and Taproot v1 "bc1p…" (Bech32m, BIP350)
 * Testnet/signet/regtest addresses and unknown witness versions are rejected,
 * so a typo can never send real deposits to an unspendable address.
 */

export type AddressType = "p2pkh" | "p2sh" | "p2wpkh" | "p2wsh" | "p2tr";
export type AddressCheck =
  | { valid: true; type: AddressType; address: string }
  | { valid: false; reason: string };

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

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

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  return [...[...hrp].map((c) => c.charCodeAt(0) >>> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
}

function convertBits(data: number[], from: number, to: number): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value >>> from) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >>> bits) & maxv);
    }
  }
  if (bits >= from || ((acc << (to - bits)) & maxv)) return null; // no padding allowed
  return out;
}

function checkSegwit(address: string): AddressCheck {
  if (address !== address.toLowerCase() && address !== address.toUpperCase()) {
    return { valid: false, reason: "Mixed upper/lower case is not allowed" };
  }
  const lower = address.toLowerCase();
  if (lower.length < 14 || lower.length > 90) return { valid: false, reason: "Invalid length" };
  const sep = lower.lastIndexOf("1");
  const hrp = lower.slice(0, sep);
  if (hrp !== "bc") return { valid: false, reason: "Not a Bitcoin mainnet address" };
  const data: number[] = [];
  for (const ch of lower.slice(sep + 1)) {
    const idx = BECH32.indexOf(ch);
    if (idx < 0) return { valid: false, reason: "Invalid character" };
    data.push(idx);
  }
  if (data.length < 7) return { valid: false, reason: "Invalid length" };
  const checksum = polymod([...hrpExpand(hrp), ...data]);
  const version = data[0];
  const expected = version === 0 ? BECH32_CONST : BECH32M_CONST;
  if (checksum !== expected) return { valid: false, reason: "Checksum mismatch" };
  const program = convertBits(data.slice(1, -6), 5, 8);
  if (!program) return { valid: false, reason: "Invalid witness program" };
  if (version === 0 && program.length === 20) return { valid: true, type: "p2wpkh", address: lower };
  if (version === 0 && program.length === 32) return { valid: true, type: "p2wsh", address: lower };
  if (version === 1 && program.length === 32) return { valid: true, type: "p2tr", address: lower };
  return { valid: false, reason: "Unsupported witness version or program length" };
}

function checkBase58(address: string): AddressCheck {
  if (address.length < 26 || address.length > 35) return { valid: false, reason: "Invalid length" };
  const raw = base58Decode(address);
  if (!raw || raw.length !== 25) return { valid: false, reason: "Invalid Base58 address" };
  const payload = raw.slice(0, 21);
  const check = sha256(sha256(payload)).slice(0, 4);
  if (!check.every((b, i) => b === raw[21 + i])) return { valid: false, reason: "Checksum mismatch" };
  if (raw[0] === 0x00) return { valid: true, type: "p2pkh", address };
  if (raw[0] === 0x05) return { valid: true, type: "p2sh", address };
  return { valid: false, reason: "Not a Bitcoin mainnet address" };
}

export function validateBitcoinAddress(input: string): AddressCheck {
  const address = (input ?? "").trim();
  if (!address) return { valid: false, reason: "Address is empty" };
  if (/^bc1/i.test(address)) return checkSegwit(address);
  if (/^(tb1|bcrt1)/i.test(address)) return { valid: false, reason: "Testnet/regtest addresses are not accepted (Bitcoin Mainnet only)" };
  if (/^[13]/.test(address)) return checkBase58(address);
  return { valid: false, reason: "Not a Bitcoin mainnet address" };
}

/** Bitcoin transaction id: 64 hex characters. */
export function normalizeTxid(input: string): string | null {
  const txid = (input ?? "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(txid) ? txid : null;
}
