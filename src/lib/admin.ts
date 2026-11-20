import { getSessionToken } from "@/lib/auth/session";
import { validateBitcoinAddress } from "@/lib/btc/address";
import { verifyBtcDeposit } from "@/lib/btc/chain";
import {
  toMethodConfig,
  type DepositVerification,
  type MethodConfig,
  type PaymentMethod,
} from "@/lib/payment-methods";
import { AuthError, RpcError, SetupError, rpc, serviceRpc } from "@/lib/supabase";
import { assertSchema } from "@/lib/system";
import { USDT_TRC20_CONTRACT, validateTronAddress } from "@/lib/tron/address";
import { verifyUsdtTrc20Deposit } from "@/lib/tron/chain";
import { toDeposit, toTransaction, type Deposit, type Notification, type Transaction } from "@/lib/wallet";

/** Every function here is re-checked in the database against admin_roles. */

export type AdminDeposit = Deposit & {
  verification: DepositVerification | null;
  reviewedBy: string | null;
  user: { id: string; name: string; email: string; accountNumber: string; balance: number; memberSince: string };
};

export type AdminDepositDetail = AdminDeposit & {
  requiredConfirmations: number;
  userTransactions: Transaction[];
};

export type AdminOverview = {
  admin: { name: string; email: string; username: string | null };
  counts: {
    /** Unread "new payment request" notifications of this admin. */
    new: number;
    byMethod: Record<PaymentMethod, { reviewing: number; approved: number; rejected: number }>;
    reviewing: number;
    awaitingPayment: number;
    approved: number;
    rejected: number;
    users: number;
    totalBalance: number;
  };
  notifications: Notification[];
  unreadCount: number;
  auditLog: AuditEntry[];
  settings: {
    methods: MethodConfig[];
    minUsd: number;
    maxUsd: number;
    quoteMinutes: number;
  };
};

export type AuditEntry = {
  id: number;
  admin: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};

export type AdminTransaction = Transaction & { user: { name: string; email: string; accountNumber: string } };

const DEPOSIT_STATUSES = ["awaiting_payment", "reviewing", "approved", "rejected", "expired", "cancelled"];

async function token(): Promise<string> {
  const value = await getSessionToken();
  if (!value) throw new AuthError();
  return value;
}

function toAdminDeposit(raw: Record<string, unknown>): AdminDeposit {
  const user = raw.user as Record<string, unknown>;
  return {
    ...toDeposit(raw),
    verification: (raw.verification as DepositVerification | null) ?? null,
    reviewedBy: (raw.reviewedBy as string | null) ?? null,
    user: { ...(user as AdminDeposit["user"]), balance: Number(user?.balance ?? 0) },
  };
}

export async function getAdminOverview(): Promise<AdminOverview> {
  await assertSchema();
  const raw = await rpc<Record<string, unknown>>("igw_admin_overview", { p_token: await token() });
  const counts = raw.counts as Record<string, unknown>;
  const settings = raw.settings as Record<string, unknown>;
  // Old database (no per-method settings): say so instead of showing an empty page.
  if (!Array.isArray(settings?.methods)) {
    throw new SetupError("The database is on an older version. Run the whole supabase/schema.sql in the Supabase SQL Editor, then reload.");
  }
  return {
    admin: raw.admin as AdminOverview["admin"],
    counts: {
      ...(Object.fromEntries(
        Object.entries(counts).filter(([k]) => k !== "byMethod").map(([k, v]) => [k, Number(v)]),
      ) as Omit<AdminOverview["counts"], "byMethod">),
      byMethod: (counts.byMethod ?? {}) as AdminOverview["counts"]["byMethod"],
    },
    notifications: ((raw.notifications as Record<string, unknown>[]) ?? []).map((n) => ({
      ...(n as unknown as Notification),
      id: Number(n.id),
      read: Boolean(n.read),
    })),
    unreadCount: Number(raw.unreadCount ?? 0),
    auditLog: ((raw.auditLog as Record<string, unknown>[]) ?? []).map((a) => ({
      ...(a as unknown as AuditEntry),
      id: Number(a.id),
    })),
    settings: {
      methods: ((settings.methods as Record<string, unknown>[]) ?? []).map(toMethodConfig),
      minUsd: Number(settings.minUsd),
      maxUsd: Number(settings.maxUsd),
      quoteMinutes: Number(settings.quoteMinutes),
    },
  };
}

export async function listDeposits(status: string | null): Promise<AdminDeposit[]> {
  const filter = status && DEPOSIT_STATUSES.includes(status) ? status : null;
  const rows = await rpc<Record<string, unknown>[]>("igw_admin_deposits", {
    p_token: await token(),
    p_status: filter,
    p_limit: 200,
  });
  return (rows ?? []).map(toAdminDeposit);
}

export async function getDeposit(id: number): Promise<AdminDepositDetail> {
  const raw = await rpc<Record<string, unknown>>("igw_admin_deposit", { p_token: await token(), p_id: id });
  if (typeof raw.depositAddress !== "string" || !raw.method) {
    // Never verify against an empty address because the database answered in an old format.
    throw new SetupError("The database is on an older version. Run the whole supabase/schema.sql in the Supabase SQL Editor, then reload.");
  }
  return {
    ...toAdminDeposit(raw),
    requiredConfirmations: Number(raw.requiredConfirmations),
    userTransactions: ((raw.userTransactions as Record<string, unknown>[]) ?? []).map(toTransaction),
  };
}

/**
 * Checks the request's TXID on the blockchain of ITS payment method (Bitcoin
 * mainnet or TRON mainnet + official USDT contract). Read-only, changes nothing.
 * Always uses the address stored with the request, not the current setting.
 */
export async function checkDepositOnChain(id: number): Promise<DepositVerification> {
  const deposit = await getDeposit(id);
  if (!deposit.txid) throw new RpcError("The user has not submitted a transaction ID yet.");
  const input = {
    txid: deposit.txid,
    address: deposit.depositAddress,
    amountUnits: deposit.amountUnits,
    createdAt: deposit.createdAt,
    expiresAt: deposit.expiresAt,
  };
  return deposit.method === "usdt_trc20"
    ? verifyUsdtTrc20Deposit(input, deposit.requiredConfirmations)
    : verifyBtcDeposit(input, deposit.requiredConfirmations);
}

/**
 * Approves only after a fresh blockchain check done here on the server; the
 * browser cannot supply or skip the verification. The database credits the
 * balance once, atomically, and refuses a second approval.
 */
export async function approveDeposit(id: number): Promise<{ deposit: AdminDeposit; verification: DepositVerification }> {
  await assertSchema();
  const verification = await checkDepositOnChain(id);
  if (!verification.matched) {
    // The request stays PENDING: nothing is rejected automatically. The admin can retry later or reject.
    const failed = verification.checks.filter((c) => !c.ok && !c.advisory).map((c) => `${c.label}: ${c.detail}`).join(" · ");
    throw new RpcError(`Not approved — payment not verified on the blockchain. ${failed}. The request stays pending; the balance was not changed.`);
  }
  const result = await serviceRpc<{ deposit: Record<string, unknown> }>("igw_admin_approve", {
    p_token: await token(),
    p_id: id,
    p_verification: verification,
  });
  return { deposit: toAdminDeposit(result.deposit), verification };
}

export async function rejectDeposit(id: number, reason: string): Promise<AdminDeposit> {
  const result = await rpc<{ deposit: Record<string, unknown> }>("igw_admin_reject", {
    p_token: await token(),
    p_id: id,
    p_reason: reason,
  });
  return toAdminDeposit(result.deposit);
}

export async function listAllTransactions(): Promise<AdminTransaction[]> {
  const rows = await rpc<Record<string, unknown>[]>("igw_admin_transactions", { p_token: await token(), p_limit: 300 });
  return (rows ?? []).map((row) => ({
    ...toTransaction(row),
    user: row.user as AdminTransaction["user"],
  }));
}

/**
 * Sets the deposit address of one method after a full checksum check
 * (Bitcoin mainnet / TRON mainnet). New requests use it; existing requests
 * keep the address they were shown.
 */
export async function setDepositAddress(method: PaymentMethod, address: string): Promise<string> {
  let normalized: string;
  if (method === "btc") {
    const check = validateBitcoinAddress(address);
    if (!check.valid) throw new RpcError(`Invalid Bitcoin mainnet address: ${check.reason}.`);
    normalized = check.address;
  } else {
    const check = validateTronAddress(address);
    if (!check.valid) throw new RpcError(`Invalid TRON (TRC20) address: ${check.reason}.`);
    if (check.address === USDT_TRC20_CONTRACT) {
      throw new RpcError("This is the USDT token contract, not a wallet address.");
    }
    normalized = check.address;
  }
  await assertSchema();
  const result = await rpc<{ address: string }>("igw_admin_set_deposit_address", {
    p_token: await token(),
    p_method: method,
    p_address: normalized,
  });
  return result.address;
}

/** Turns one payment method on or off for members (recorded in the audit log). */
export async function setMethodEnabled(method: PaymentMethod, enabled: boolean): Promise<boolean> {
  const result = await rpc<{ enabled: boolean }>("igw_admin_set_method_enabled", {
    p_token: await token(),
    p_method: method,
    p_enabled: enabled,
  });
  return Boolean(result.enabled);
}

/** Throws unless the session belongs to an admin (checked in the database). */
export async function requireAdminSession(): Promise<void> {
  await rpc("igw_admin_poll", { p_token: await token() });
}

export type AdminPoll = {
  reviewing: number;
  approved: number;
  rejected: number;
  unreadCount: number;
  latestRequestNotificationId: number | null;
  newRequests: { notificationId: number; requestId: number; reference: string; method: PaymentMethod; amountUsd: number; userName: string }[];
};

/** Light check every few seconds from the admin panel (sound alert, counters). */
export async function pollAdmin(): Promise<AdminPoll> {
  const raw = await rpc<Record<string, unknown>>("igw_admin_poll", { p_token: await token() });
  return {
    reviewing: Number(raw.reviewing ?? 0),
    approved: Number(raw.approved ?? 0),
    rejected: Number(raw.rejected ?? 0),
    unreadCount: Number(raw.unreadCount ?? 0),
    latestRequestNotificationId: raw.latestRequestNotificationId == null ? null : Number(raw.latestRequestNotificationId),
    newRequests: ((raw.newRequests as Record<string, unknown>[]) ?? []).map((n) => ({
      notificationId: Number(n.notificationId),
      requestId: Number(n.requestId),
      reference: String(n.reference ?? ""),
      method: n.method === "usdt_trc20" ? "usdt_trc20" : "btc",
      amountUsd: Number(n.amountUsd ?? 0),
      userName: String(n.userName ?? ""),
    })),
  };
}

export async function markAdminNotificationsRead(ids: number[] | null): Promise<void> {
  await rpc("igw_notifications_read", { p_token: await token(), p_ids: ids });
}
