/**
 * Cards and withdrawals — shared types (browser + server, no secrets).
 * A member needs an ACTIVE card to request a withdrawal. Cards are requested by the
 * member and activated / changed / deactivated by an admin (no fee). Limits are per
 * card tier over the last 24 hours and are enforced in the database.
 */

export type CardTier = "standard" | "gold" | "premium" | "merchant";

export const CARD_TIERS: CardTier[] = ["standard", "gold", "premium", "merchant"];

export const CARD_TIER_STYLE: Record<CardTier, { name: string; gradient: string; text: string }> = {
  standard: { name: "Standard", gradient: "from-slate-500 to-slate-700", text: "text-white" },
  gold: { name: "Gold", gradient: "from-amber-300 to-amber-600", text: "text-amber-950" },
  premium: { name: "Premium", gradient: "from-[#7F00FF] to-[#10152b]", text: "text-white" },
  merchant: { name: "Merchant", gradient: "from-emerald-500 to-teal-800", text: "text-white" },
};

export function isCardTier(value: unknown): value is CardTier {
  return value === "standard" || value === "gold" || value === "premium" || value === "merchant";
}

export type MemberCard = {
  cardNumber: string;
  tier: CardTier;
  tierName: string;
  status: "active" | "inactive";
  /** USD per 24 h; null = unlimited. */
  dailyLimit: number | null;
  activatedAt: string | null;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  updatedAt: string;
};

export type CardRequest = {
  id: number;
  reference: string;
  accountNumber: string;
  userName: string;
  tier: CardTier;
  tierName: string;
  dailyLimit: number | null;
  note: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  createdAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
};

export type Withdrawal = {
  id: number;
  reference: string;
  accountNumber: string;
  userName: string;
  amountUsd: number;
  method: "btc";
  btcAddress: string;
  cardTier: CardTier;
  cardTierName: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  txid: string | null;
  createdAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  reviewedBy: string | null;
};

export type TierInfo = { tier: CardTier; name: string; dailyLimit: number | null };

export type WithdrawalCenter = {
  card: MemberCard | null;
  pendingCardRequest: CardRequest | null;
  lastCardRequest: CardRequest | null;
  tiers: TierInfo[];
  canWithdraw: boolean;
  dailyLimit: number | null;
  usedLast24h: number;
  /** null = unlimited */
  remainingToday: number | null;
  minUsd: number;
  withdrawals: Withdrawal[];
};

const num = (v: unknown) => Number(v ?? 0);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function toCard(raw: unknown): MemberCard | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  return { ...(c as unknown as MemberCard), dailyLimit: numOrNull(c.dailyLimit) };
}

export function toCardRequest(raw: unknown): CardRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return { ...(r as unknown as CardRequest), id: num(r.id), dailyLimit: numOrNull(r.dailyLimit) };
}

export function toWithdrawal(raw: Record<string, unknown>): Withdrawal {
  return { ...(raw as unknown as Withdrawal), id: num(raw.id), amountUsd: num(raw.amountUsd) };
}

export function toWithdrawalCenter(raw: Record<string, unknown> | null | undefined): WithdrawalCenter {
  const r = raw ?? {};
  return {
    card: toCard(r.card),
    pendingCardRequest: toCardRequest(r.pendingCardRequest),
    lastCardRequest: toCardRequest(r.lastCardRequest),
    tiers: ((r.tiers as Record<string, unknown>[]) ?? []).map((t) => ({
      tier: t.tier as CardTier,
      name: String(t.name),
      dailyLimit: numOrNull(t.dailyLimit),
    })),
    canWithdraw: r.canWithdraw === true,
    dailyLimit: numOrNull(r.dailyLimit),
    usedLast24h: num(r.usedLast24h),
    remainingToday: numOrNull(r.remainingToday),
    minUsd: num(r.minUsd),
    withdrawals: ((r.withdrawals as Record<string, unknown>[]) ?? []).map(toWithdrawal),
  };
}
