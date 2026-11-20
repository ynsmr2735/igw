import { getSessionToken } from "@/lib/auth/session";
import { getBtcUsdPrice } from "@/lib/btc/price";
import { toMethodConfig, type MethodConfig, type PaymentMethod } from "@/lib/payment-methods";
import { AuthError, RpcError, rpc, serviceRpc } from "@/lib/supabase";
import { assertSchema } from "@/lib/system";

export { formatDate, formatMoney, initialsOf } from "./format";

export type DepositStatus =
  | "awaiting_payment"
  | "reviewing"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

export type Deposit = {
  id: number;
  reference: string;
  method: PaymentMethod;
  asset: "BTC" | "USDT";
  network: "mainnet" | "tron";
  accountNumber: string;
  amountUsd: number;
  /** USD per coin at quote time (BTC price; 1.00 for USDT). */
  usdRate: number;
  rateSource: string;
  /** Smallest units: satoshis (BTC) or micro-USDT (6 decimals). */
  amountUnits: number;
  /** Amount to send, as text (BTC 8 decimals, USDT 2). */
  amountCrypto: string;
  /** Address shown for THIS request (kept even if the admin changes the address later). */
  depositAddress: string;
  status: DepositStatus;
  txid: string | null;
  expiresAt: string;
  submitDeadline: string;
  createdAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  userName?: string | null;
};

export type Transaction = {
  id: number;
  reference: string;
  type: string;
  direction: "in" | "out";
  amount: number;
  currency: string;
  counterparty: string;
  counterpartyAccount: string | null;
  description: string;
  status: "pending" | "completed" | "failed" | "cancelled";
  createdAt: string;
};

export type Notification = {
  id: number;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read: boolean;
  createdAt: string;
};

export type DepositConfig = {
  /** BTC and USDT TRC20, each with its own address and on/off switch. */
  methods: MethodConfig[];
  minUsd: number;
  maxUsd: number;
  quoteMinutes: number;
};

export type DashboardData = {
  user: {
    name: string;
    email: string;
    plan: string;
    username: string | null;
    accountNumber: string;
    isAdmin: boolean;
    memberSince: string;
    initials: string;
  };
  wallet: { balance: number; currency: "USD"; accountNumber: string };
  transactions: Transaction[];
  notifications: Notification[];
  unreadCount: number;
  deposits: Deposit[];
  openDeposit: Deposit | null;
  depositConfig: DepositConfig;
  stats: { moneyIn: number; moneyOut: number };
};

export type TransferResult = {
  ok: true;
  duplicate: boolean;
  reference: string;
  amount: number;
  recipientName: string;
  recipientAccount: string;
  balance: number;
  createdAt: string;
};

/* ---------------- normalisation (Postgres numerics arrive as numbers or strings) ---------------- */

const num = (value: unknown) => Number(value ?? 0);

export function toDeposit(raw: Record<string, unknown>): Deposit {
  return {
    ...(raw as unknown as Deposit),
    id: num(raw.id),
    method: raw.method === "usdt_trc20" ? "usdt_trc20" : "btc",
    asset: raw.method === "usdt_trc20" ? "USDT" : "BTC",
    network: raw.method === "usdt_trc20" ? "tron" : "mainnet",
    amountUsd: num(raw.amountUsd),
    usdRate: num(raw.usdRate),
    amountUnits: num(raw.amountUnits),
    amountCrypto: String(raw.amountCrypto ?? ""),
    depositAddress: String(raw.depositAddress ?? ""),
  };
}

export function toTransaction(raw: Record<string, unknown>): Transaction {
  return {
    ...(raw as unknown as Transaction),
    id: num(raw.id),
    amount: num(raw.amount),
    direction: raw.direction === "in" ? "in" : "out",
    description: String(raw.description ?? ""),
  };
}

function toNotification(raw: Record<string, unknown>): Notification {
  return { ...(raw as unknown as Notification), id: num(raw.id), read: Boolean(raw.read) };
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

async function requireToken(): Promise<string> {
  const token = await getSessionToken();
  if (!token) throw new AuthError();
  return token;
}

/* ---------------- dashboard ---------------- */

type DashboardRpc = { ok: false } | ({ ok: true } & Record<string, unknown>);

/** Wallet data for the signed-in user, or null when the session is missing/expired. */
export async function getDashboardData(): Promise<DashboardData | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const data = await rpc<DashboardRpc>("igw_dashboard", { p_token: token });
  if (!data?.ok) return null;

  const user = data.user as DashboardData["user"];
  const wallet = data.wallet as Record<string, unknown>;
  const config = data.depositConfig as Record<string, unknown>;
  const flows = (data.flows ?? {}) as Record<string, unknown>;

  return {
    user: { ...user, isAdmin: Boolean(user.isAdmin), initials: initials(user.name) },
    wallet: { balance: num(wallet.balance), currency: "USD", accountNumber: String(wallet.accountNumber) },
    transactions: ((data.transactions as Record<string, unknown>[]) ?? []).map(toTransaction),
    notifications: ((data.notifications as Record<string, unknown>[]) ?? []).map(toNotification),
    unreadCount: num(data.unreadCount),
    deposits: ((data.deposits as Record<string, unknown>[]) ?? []).map(toDeposit),
    openDeposit: data.openDeposit ? toDeposit(data.openDeposit as Record<string, unknown>) : null,
    depositConfig: {
      methods: ((config.methods as Record<string, unknown>[]) ?? []).map(toMethodConfig),
      minUsd: num(config.minUsd),
      maxUsd: num(config.maxUsd),
      quoteMinutes: num(config.quoteMinutes),
    },
    stats: { moneyIn: num(flows.moneyIn), moneyOut: num(flows.moneyOut) },
  };
}

/* ---------------- deposits ---------------- */

/**
 * Creates a payment request. The rate is decided here, on the server, never
 * taken from the browser: BTC uses the live BTC/USD price, USDT is 1:1.
 */
export async function createDeposit(method: PaymentMethod, amountUsd: number): Promise<Deposit> {
  const token = await requireToken();
  await assertSchema();
  let rate = 1;
  let source = "USDT 1:1";
  if (method === "btc") {
    const price = await getBtcUsdPrice();
    rate = price.rate;
    source = price.source;
  } else if (method !== "usdt_trc20") {
    throw new RpcError("Unknown payment method.");
  }
  const raw = await serviceRpc<Record<string, unknown>>("igw_deposit_create", {
    p_token: token,
    p_method: method,
    p_amount_usd: amountUsd,
    p_usd_rate: rate,
    p_rate_source: source,
  });
  return toDeposit(raw);
}

/** "I've paid": records the TXID; the balance does NOT change until an admin approves. */
export async function submitDeposit(requestId: number, txid: string): Promise<Deposit> {
  const token = await requireToken();
  const raw = await rpc<Record<string, unknown>>("igw_deposit_submit", {
    p_token: token,
    p_request_id: requestId,
    p_txid: txid,
  });
  return toDeposit(raw);
}

export async function cancelDeposit(requestId: number): Promise<Deposit> {
  const token = await requireToken();
  const raw = await rpc<Record<string, unknown>>("igw_deposit_cancel", { p_token: token, p_request_id: requestId });
  return toDeposit(raw);
}

/* ---------------- transfers ---------------- */

export async function lookupRecipient(accountNumber: string): Promise<{ accountNumber: string; name: string }> {
  const token = await requireToken();
  return rpc("igw_transfer_lookup", { p_token: token, p_account_number: accountNumber });
}

export async function sendTransfer(input: {
  accountNumber: string;
  amount: number;
  idempotencyKey: string;
  note?: string;
}): Promise<TransferResult> {
  const token = await requireToken();
  const raw = await rpc<Record<string, unknown>>("igw_transfer_send", {
    p_token: token,
    p_account_number: input.accountNumber,
    p_amount: input.amount,
    p_idempotency_key: input.idempotencyKey,
    p_note: input.note ?? "",
  });
  return { ...(raw as unknown as TransferResult), amount: num(raw.amount), balance: num(raw.balance) };
}

/* ---------------- notifications ---------------- */

export async function markNotificationsRead(ids: number[] | null): Promise<number> {
  const token = await requireToken();
  const result = await rpc<{ updated: number }>("igw_notifications_read", { p_token: token, p_ids: ids });
  return num(result?.updated);
}
