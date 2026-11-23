import { getSessionToken } from "@/lib/auth/session";
import { validateBitcoinAddress } from "@/lib/btc/address";
import {
  toCard,
  toCardRequest,
  toWithdrawal,
  type CardRequest,
  type CardTier,
  type MemberCard,
  type Withdrawal,
} from "@/lib/cards";
import { toContact, type ContactInfo } from "@/lib/contact";
import { toAdminKyc, type AdminKycSubmission } from "@/lib/kyc";
import { toMethodConfig, type MethodConfig, type PaymentMethod } from "@/lib/payment-methods";
import { AuthError, RpcError, SetupError, rpc } from "@/lib/supabase";
import { assertSchema } from "@/lib/system";
import { USDT_TRC20_CONTRACT, validateTronAddress } from "@/lib/tron/address";
import { toDeposit, toTransaction, type Deposit, type Notification, type Transaction } from "@/lib/wallet";

/** Every function here is re-checked in the database against admin_roles. */

export type AdminDeposit = Deposit & {
  reviewedBy: string | null;
  user: { id: string; name: string; email: string; accountNumber: string; balance: number; memberSince: string };
};

export type AdminDepositDetail = AdminDeposit & {
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
    withdrawalsPending: number;
    cardRequestsPending: number;
    kycPending: number;
    activeCards: number;
    users: number;
    totalBalance: number;
  };
  notifications: Notification[];
  unreadCount: number;
  auditLog: AuditEntry[];
  /** Contact details shown on the website. */
  contact: ContactInfo;
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
    contact: toContact(raw.contact),
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
    // The database answered in an old format: say so instead of showing wrong data.
    throw new SetupError("The database is on an older version. Run the whole supabase/schema.sql in the Supabase SQL Editor, then reload.");
  }
  return {
    ...toAdminDeposit(raw),
    userTransactions: ((raw.userTransactions as Record<string, unknown>[]) ?? []).map(toTransaction),
  };
}

/**
 * Manual approval: the admin's decision completes the payment. There is no
 * blockchain check. The database (admin session required) credits the balance once,
 * atomically, completes the transaction, notifies the member and writes the audit log.
 * creditUsd: optional lower amount actually received (default: the requested amount).
 */
export async function approveDeposit(
  id: number,
  creditUsd: number | null = null,
): Promise<{ deposit: AdminDeposit; creditedUsd: number }> {
  await assertSchema();
  const result = await rpc<{ deposit: Record<string, unknown>; creditedUsd: number }>("igw_admin_approve", {
    p_token: await token(),
    p_id: id,
    p_credit_usd: creditUsd,
  });
  return { deposit: toAdminDeposit(result.deposit), creditedUsd: Number(result.creditedUsd) };
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
  withdrawalsPending: number;
  cardRequestsPending: number;
  kycPending: number;
  /** Unseen withdrawal requests and card requests (for the sound alert and highlighting). */
  newOther: { notificationId: number; kind: "withdrawal_submitted" | "card_requested"; id: number; reference: string; amountUsd: number | null; tier: string | null; userName: string }[];
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
    withdrawalsPending: Number(raw.withdrawalsPending ?? 0),
    cardRequestsPending: Number(raw.cardRequestsPending ?? 0),
    kycPending: Number(raw.kycPending ?? 0),
    newOther: ((raw.newOther as Record<string, unknown>[]) ?? []).map((n) => ({
      notificationId: Number(n.notificationId),
      kind: n.kind === "card_requested" ? "card_requested" : "withdrawal_submitted",
      id: Number(n.id),
      reference: String(n.reference ?? ""),
      amountUsd: n.amountUsd == null ? null : Number(n.amountUsd),
      tier: (n.tier as string | null) ?? null,
      userName: String(n.userName ?? ""),
    })),
  };
}

export async function markAdminNotificationsRead(ids: number[] | null): Promise<void> {
  await rpc("igw_notifications_read", { p_token: await token(), p_ids: ids });
}

/* ---------------- cards and withdrawals (admin) ---------------- */

export type AdminWithdrawal = Withdrawal & { user: { id: string; name: string; email: string; accountNumber: string; balance: number } };
export type AdminCardRequest = CardRequest & { currentCard: MemberCard | null; email: string; balance: number; reviewedBy: string | null; kyc: AdminKycSubmission | null };
export type AdminCard = MemberCard & { userName: string; email: string; accountNumber: string; usedLast24h: number };
export type MemberLookup = { name: string; email: string; accountNumber: string; balance: number; card: MemberCard | null; usedLast24h: number; kyc: AdminKycSubmission | null };

const WITHDRAWAL_STATUSES = ["pending", "approved", "rejected", "cancelled"];

function toAdminWithdrawal(raw: Record<string, unknown>): AdminWithdrawal {
  const user = (raw.user ?? {}) as Record<string, unknown>;
  return { ...toWithdrawal(raw), user: { ...(user as AdminWithdrawal["user"]), balance: Number(user.balance ?? 0) } };
}

export async function listWithdrawals(status: string | null): Promise<AdminWithdrawal[]> {
  const rows = await rpc<Record<string, unknown>[]>("igw_admin_withdrawals", {
    p_token: await token(),
    p_status: status && WITHDRAWAL_STATUSES.includes(status) ? status : null,
  });
  return (rows ?? []).map(toAdminWithdrawal);
}

/** Admin marks a withdrawal as sent (after sending the BTC from the company wallet). TXID optional. */
export async function approveWithdrawal(id: number, txid: string | null): Promise<AdminWithdrawal> {
  await assertSchema();
  const clean = txid?.trim().toLowerCase() || null;
  if (clean && !/^[0-9a-f]{64}$/.test(clean)) throw new RpcError("The transaction ID (TXID) must be 64 hexadecimal characters (or leave it empty).");
  const result = await rpc<{ withdrawal: Record<string, unknown> }>("igw_admin_withdrawal_approve", { p_token: await token(), p_id: id, p_txid: clean });
  return toAdminWithdrawal(result.withdrawal);
}

/** Rejection returns the amount to the member's balance. */
export async function rejectWithdrawal(id: number, reason: string): Promise<AdminWithdrawal> {
  const result = await rpc<{ withdrawal: Record<string, unknown> }>("igw_admin_withdrawal_reject", { p_token: await token(), p_id: id, p_reason: reason });
  return toAdminWithdrawal(result.withdrawal);
}

export async function listCardRequests(status: string | null): Promise<AdminCardRequest[]> {
  const rows = await rpc<Record<string, unknown>[]>("igw_admin_card_requests", {
    p_token: await token(),
    p_status: status && ["pending", "approved", "rejected", "cancelled"].includes(status) ? status : null,
  });
  return (rows ?? []).map((r) => ({
    ...toCardRequest(r)!,
    currentCard: toCard(r.currentCard),
    kyc: toAdminKyc(r.kyc),
    email: String(r.email ?? ""),
    balance: Number(r.balance ?? 0),
    reviewedBy: (r.reviewedBy as string | null) ?? null,
  }));
}

export async function decideCardRequest(id: number, approve: boolean, reason: string | null): Promise<CardRequest> {
  await assertSchema();
  const result = await rpc<{ request: Record<string, unknown> }>("igw_admin_card_request_decide", {
    p_token: await token(),
    p_id: id,
    p_approve: approve,
    p_reason: reason,
  });
  return toCardRequest(result.request)!;
}

export async function listCards(): Promise<AdminCard[]> {
  const rows = await rpc<Record<string, unknown>[]>("igw_admin_cards", { p_token: await token() });
  return (rows ?? []).map((r) => ({
    ...toCard(r)!,
    userName: String(r.userName ?? ""),
    email: String(r.email ?? ""),
    accountNumber: String(r.accountNumber ?? ""),
    usedLast24h: Number(r.usedLast24h ?? 0),
  }));
}

/** Activate / change tier (active = true) or deactivate (active = false) a member's card. */
export async function setCard(accountNumber: string, tier: CardTier | null, active: boolean, reason: string | null): Promise<MemberCard | null> {
  await assertSchema();
  const result = await rpc<{ card: unknown }>("igw_admin_set_card", {
    p_token: await token(),
    p_account_number: accountNumber,
    p_tier: tier,
    p_active: active,
    p_reason: reason,
  });
  return toCard(result.card);
}

export async function lookupMember(accountNumber: string): Promise<MemberLookup> {
  const raw = await rpc<Record<string, unknown>>("igw_admin_member_lookup", { p_token: await token(), p_account_number: accountNumber });
  return {
    name: String(raw.name ?? ""),
    email: String(raw.email ?? ""),
    accountNumber: String(raw.accountNumber ?? ""),
    balance: Number(raw.balance ?? 0),
    card: toCard(raw.card),
    kyc: toAdminKyc(raw.kyc),
    usedLast24h: Number(raw.usedLast24h ?? 0),
  };
}

/** Saves the website contact details (validated + audited in the database). */
export async function setContact(contact: Record<string, string>): Promise<ContactInfo> {
  return toContact(await rpc<unknown>("igw_admin_set_contact", { p_token: await token(), p_contact: contact }));
}

/** Identity documents (KYC) submitted by members; pending first. */
export async function listKyc(status: "pending" | "approved" | "rejected" | null): Promise<AdminKycSubmission[]> {
  const raw = await rpc<unknown[]>("igw_admin_kyc_list", { p_token: await token(), p_status: status });
  return (raw ?? []).map((r) => toAdminKyc(r)!).filter(Boolean);
}

/** Approve or reject identity documents (rejecting also closes a pending card request). */
export async function decideKyc(id: number, approve: boolean, reason: string | null): Promise<AdminKycSubmission> {
  const raw = await rpc<{ kyc: unknown }>("igw_admin_kyc_decide", { p_token: await token(), p_id: id, p_approve: approve, p_reason: reason });
  return toAdminKyc(raw.kyc)!;
}

/** Storage path of one identity photo (admin only). */
export async function kycFile(id: number, side: "front" | "back"): Promise<{ path: string; type: string; size: number }> {
  return rpc("igw_admin_kyc_file", { p_token: await token(), p_id: id, p_side: side });
}

/** One line of the member list. */
export type MemberSummary = {
  accountNumber: string;
  previousAccountNumber: string | null;
  name: string;
  email: string;
  username: string | null;
  createdAt: string;
  isAdmin: boolean;
  balance: number;
  card: { tier: CardTier; status: string; expired: boolean } | null;
  kycStatus: "none" | "pending" | "approved" | "rejected";
  lastSeenAt: string | null;
  mustChangePassword: boolean;
  passwordChangedAt: string | null;
};

export type MemberDetail = MemberSummary & {
  plan: string;
  activeSessions: number;
  cardDetails: MemberCard | null;
  usedLast24h: number;
  kyc: AdminKycSubmission[];
  transactions: Transaction[];
  deposits: Deposit[];
  withdrawals: Withdrawal[];
  cardRequests: CardRequest[];
  passwordResets: { at: string; by: string }[];
};

function toMemberSummary(r: Record<string, unknown>): MemberSummary {
  return {
    ...(r as unknown as MemberSummary),
    balance: Number(r.balance ?? 0),
    isAdmin: r.isAdmin === true,
    mustChangePassword: r.mustChangePassword === true,
  };
}

/** Members (newest first), optionally filtered by name, email, username or account number. */
export async function listMembers(search: string, offset = 0): Promise<{ total: number; totalMembers: number; members: MemberSummary[] }> {
  const raw = await rpc<{ total: number; totalMembers: number; members: Record<string, unknown>[] }>("igw_admin_members", {
    p_token: await token(),
    p_search: search,
    p_offset: offset,
  });
  return { total: Number(raw.total ?? 0), totalMembers: Number(raw.totalMembers ?? 0), members: (raw.members ?? []).map(toMemberSummary) };
}

export async function getMemberDetail(accountNumber: string): Promise<MemberDetail> {
  const r = await rpc<Record<string, unknown>>("igw_admin_member_detail", { p_token: await token(), p_account_number: accountNumber });
  return {
    ...toMemberSummary(r),
    plan: String(r.plan ?? ""),
    activeSessions: Number(r.activeSessions ?? 0),
    cardDetails: toCard(r.cardDetails),
    usedLast24h: Number(r.usedLast24h ?? 0),
    kyc: ((r.kyc as unknown[]) ?? []).map((k) => toAdminKyc(k)!).filter(Boolean),
    transactions: ((r.transactions as Record<string, unknown>[]) ?? []).map(toTransaction),
    deposits: ((r.deposits as Record<string, unknown>[]) ?? []).map(toDeposit),
    withdrawals: ((r.withdrawals as Record<string, unknown>[]) ?? []).map(toWithdrawal),
    cardRequests: ((r.cardRequests as Record<string, unknown>[]) ?? []).map((c) => toCardRequest(c)!),
    passwordResets: (r.passwordResets as { at: string; by: string }[]) ?? [],
  };
}

/** New temporary password for a member; returned once, never stored in plain text. */
export async function resetMemberPassword(accountNumber: string): Promise<{ temporaryPassword: string; email: string; name: string; accountNumber: string; sessionsEnded: number }> {
  return rpc("igw_admin_reset_password", { p_token: await token(), p_account_number: accountNumber });
}
