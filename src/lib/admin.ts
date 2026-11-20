import { getSessionToken } from "@/lib/auth/session";
import { validateBitcoinAddress } from "@/lib/btc/address";
import { verifyDeposit, type DepositVerification } from "@/lib/btc/chain";
import { AuthError, RpcError, rpc, serviceRpc } from "@/lib/supabase";
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
    enabled: boolean;
    btcAddress: string | null;
    btcAddressUpdatedAt: string | null;
    btcAddressUpdatedBy: string | null;
    network: "mainnet";
    requiredConfirmations: number;
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
  const raw = await rpc<Record<string, unknown>>("igw_admin_overview", { p_token: await token() });
  const counts = raw.counts as Record<string, unknown>;
  const settings = raw.settings as Record<string, unknown>;
  return {
    admin: raw.admin as AdminOverview["admin"],
    counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v)])) as AdminOverview["counts"],
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
      enabled: settings.enabled !== false,
      btcAddress: (settings.btcAddress as string | null) ?? null,
      btcAddressUpdatedAt: (settings.btcAddressUpdatedAt as string | null) ?? null,
      btcAddressUpdatedBy: (settings.btcAddressUpdatedBy as string | null) ?? null,
      network: "mainnet",
      requiredConfirmations: Number(settings.requiredConfirmations),
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
  return {
    ...toAdminDeposit(raw),
    requiredConfirmations: Number(raw.requiredConfirmations),
    userTransactions: ((raw.userTransactions as Record<string, unknown>[]) ?? []).map(toTransaction),
  };
}

/** Checks the request's TXID on the Bitcoin blockchain (read-only, changes nothing). */
export async function checkDepositOnChain(id: number): Promise<DepositVerification> {
  const deposit = await getDeposit(id);
  if (!deposit.txid) throw new RpcError("The user has not submitted a transaction ID yet.");
  return verifyDeposit(
    {
      txid: deposit.txid,
      btcAddress: deposit.btcAddress,
      amountSats: deposit.amountSats,
      createdAt: deposit.createdAt,
      expiresAt: deposit.expiresAt,
    },
    deposit.requiredConfirmations,
  );
}

/**
 * Approves only after a fresh blockchain check done here on the server; the
 * browser cannot supply or skip the verification. The database credits the
 * balance once, atomically, and refuses a second approval.
 */
export async function approveDeposit(id: number): Promise<{ deposit: AdminDeposit; verification: DepositVerification }> {
  const verification = await checkDepositOnChain(id);
  if (!verification.matched) {
    const failed = verification.checks.filter((c) => !c.ok).map((c) => c.label).join(", ");
    throw new RpcError(`Payment not verified on the blockchain (${failed}). The deposit was not approved.`);
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

export async function setBtcAddress(address: string): Promise<string> {
  const check = validateBitcoinAddress(address);
  if (!check.valid) throw new RpcError(`Invalid Bitcoin mainnet address: ${check.reason}.`);
  const result = await serviceRpc<{ btcAddress: string }>("igw_admin_set_btc_address", {
    p_token: await token(),
    p_address: check.address,
  });
  return result.btcAddress;
}

/** Turns the BTC payment method on or off for members (recorded in the audit log). */
export async function setDepositsEnabled(enabled: boolean): Promise<boolean> {
  const result = await rpc<{ enabled: boolean }>("igw_admin_set_deposits_enabled", {
    p_token: await token(),
    p_enabled: enabled,
  });
  return Boolean(result.enabled);
}

export async function markAdminNotificationsRead(ids: number[] | null): Promise<void> {
  await rpc("igw_notifications_read", { p_token: await token(), p_ids: ids });
}
