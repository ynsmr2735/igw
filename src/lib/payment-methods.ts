/**
 * Payment methods (shared by server and browser code — no secrets here).
 * Deposit addresses are NOT here: they are stored in the database and set by
 * the admin in the panel.
 */

export type PaymentMethod = "btc" | "usdt_trc20";

/** Database version this code needs (public.igw_health()). Run supabase/schema.sql if it differs. */
export const EXPECTED_SCHEMA = "igw-rpc-8";

export const PAYMENT_METHODS: PaymentMethod[] = ["btc", "usdt_trc20"];

export type MethodInfo = {
  method: PaymentMethod;
  asset: "BTC" | "USDT";
  name: string;
  short: string;
  network: "mainnet" | "tron";
  networkLabel: string;
  decimals: number;
  /** Smallest unit name. */
  unit: string;
  explorerName: string;
  explorerTx: (txid: string) => string;
  /** What the QR code encodes. */
  qrPayload: (address: string, amountCrypto: string) => string;
};

export const METHOD_INFO: Record<PaymentMethod, MethodInfo> = {
  btc: {
    method: "btc",
    asset: "BTC",
    name: "Bitcoin (BTC)",
    short: "BTC",
    network: "mainnet",
    networkLabel: "Bitcoin Mainnet",
    decimals: 8,
    unit: "sats",
    explorerName: "mempool.space",
    explorerTx: (txid) => `https://mempool.space/tx/${txid}`,
    qrPayload: (address, amount) => `bitcoin:${address}?amount=${amount}`,
  },
  usdt_trc20: {
    method: "usdt_trc20",
    asset: "USDT",
    name: "Tether (USDT TRC20)",
    short: "USDT TRC20",
    network: "tron",
    networkLabel: "TRON (TRC20)",
    decimals: 6,
    unit: "micro-USDT",
    explorerName: "Tronscan",
    explorerTx: (txid) => `https://tronscan.org/#/transaction/${txid}`,
    // Wallets disagree on TRON payment URIs; the plain address scans everywhere.
    qrPayload: (address) => address,
  },
};

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return value === "btc" || value === "usdt_trc20";
}

export function methodInfo(method: string | null | undefined): MethodInfo {
  return isPaymentMethod(method) ? METHOD_INFO[method] : METHOD_INFO.btc;
}

/** Live configuration of one method (from the database). */
export type MethodConfig = {
  method: PaymentMethod;
  asset: "BTC" | "USDT";
  name: string;
  network: "mainnet" | "tron";
  networkLabel: string;
  enabled: boolean;
  address: string | null;
  addressUpdatedAt: string | null;
  addressUpdatedBy: string | null;
  decimals: number;
};

export function toMethodConfig(raw: Record<string, unknown>): MethodConfig {
  const method = isPaymentMethod(raw.method) ? raw.method : "btc";
  const info = METHOD_INFO[method];
  return {
    method,
    asset: info.asset,
    name: String(raw.name ?? info.name),
    network: info.network,
    networkLabel: String(raw.networkLabel ?? info.networkLabel),
    enabled: raw.enabled !== false,
    address: (raw.address as string | null) ?? null,
    addressUpdatedAt: (raw.addressUpdatedAt as string | null) ?? null,
    addressUpdatedBy: (raw.addressUpdatedBy as string | null) ?? null,
    decimals: info.decimals,
  };
}
