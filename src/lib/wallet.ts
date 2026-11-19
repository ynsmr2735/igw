import { getSessionToken } from "@/lib/auth/session";
import { RpcError, rpc } from "@/lib/supabase";
import { CURRENCIES, initialsOf } from "./format";

export {
  CURRENCIES,
  convert,
  formatDate,
  formatMoney,
  initialsOf,
} from "./format";

export type Wallet = {
  id: number;
  currency: string;
  name: string;
  balance: number;
  accountNumber: string;
  isPrimary: boolean;
};

export type Transaction = {
  id: number;
  type: string;
  direction: "in" | "out";
  amount: number;
  currency: string;
  counterparty: string;
  note: string;
  status: string;
  createdAt: string;
};

export type Card = {
  id: number;
  label: string;
  last4: string;
  brand: string;
  type: string;
  expiry: string;
  status: string;
  theme: string;
};

export type Recipient = {
  id: number;
  name: string;
  email: string;
  currency: string;
  color: string;
  walletId?: number | null;
};

export type DashboardData = {
  user: { name: string; email: string; plan: string; initials: string };
  wallets: Wallet[];
  transactions: Transaction[];
  cards: Card[];
  recipients: Recipient[];
  stats: {
    totalUsd: number;
    moneyIn: number;
    moneyOut: number;
    currencyCount: number;
  };
};

export type ActionPayload = {
  action: string;
  amount?: number;
  note?: string;
  walletId?: number;
  recipientId?: number;
  targetWalletId?: number;
  method?: string;
  cardId?: number;
};

/** Shape returned by the igw_dashboard database function. */
type DashboardRpc =
  | { ok: false; error: string }
  | {
      ok: true;
      user: { name: string; email: string; plan: string };
      wallets: Wallet[];
      transactions: Transaction[];
      cards: Card[];
      recipients: Recipient[];
      flows: { moneyIn: number | string; moneyOut: number | string };
    };

/** Dashboard data for the signed-in user, or null when the session is missing/expired. */
export async function getDashboardData(): Promise<DashboardData | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const data = await rpc<DashboardRpc>("igw_dashboard", { p_token: token });
  if (!data?.ok) return null;

  const wallets = data.wallets.map((wallet) => ({
    ...wallet,
    id: Number(wallet.id),
    balance: Number(wallet.balance),
  }));

  return {
    user: { ...data.user, initials: initialsOf(data.user.name) },
    wallets,
    transactions: data.transactions.map((row) => ({
      ...row,
      id: Number(row.id),
      amount: Number(row.amount),
      direction: row.direction === "in" ? "in" : "out",
      note: row.note ?? "",
    })),
    cards: data.cards.map((card) => ({ ...card, id: Number(card.id) })),
    recipients: data.recipients.map((recipient) => ({
      ...recipient,
      id: Number(recipient.id),
      walletId: recipient.walletId == null ? null : Number(recipient.walletId),
    })),
    stats: {
      totalUsd: wallets.reduce(
        (total, wallet) => total + wallet.balance * (CURRENCIES[wallet.currency]?.usd ?? 1),
        0,
      ),
      moneyIn: Number(data.flows?.moneyIn ?? 0),
      moneyOut: Number(data.flows?.moneyOut ?? 0),
      currencyCount: wallets.length,
    },
  };
}

export async function executeAction(payload: ActionPayload): Promise<{ convertedAmount?: number }> {
  const token = await getSessionToken();
  if (!token) throw new RpcError("You must be signed in");

  const result = await rpc<{ ok: boolean; converted_amount?: number | string }>("igw_wallet_action", {
    p_token: token,
    p_action: payload.action,
    p_amount: payload.amount ?? 0,
    p_wallet_id: payload.walletId ?? null,
    p_target_wallet_id: payload.targetWalletId ?? null,
    p_recipient_id: payload.recipientId ?? null,
    p_card_id: payload.cardId ?? null,
    p_note: payload.note ?? "",
    p_method: payload.method ?? "",
  });

  return result?.converted_amount == null ? {} : { convertedAmount: Number(result.converted_amount) };
}
