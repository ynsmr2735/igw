import { randomInt } from "node:crypto";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { cards, recipients, transactions, wallets } from "@/db/schema";
import { requireSessionUser } from "@/lib/auth/session";
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/* ------------------------------------------------------------------ */
/* New account                                                         */
/* ------------------------------------------------------------------ */

/** Starter wallets, card and saved recipients for a freshly created profile. */
export async function provisionStarterData(tx: Tx, userId: string): Promise<void> {
  // 12 hex chars of the random uuid keeps account numbers unique in practice.
  const suffix = userId.replace(/-/g, "").slice(0, 12).toUpperCase();
  const last4 = String(randomInt(0, 10000)).padStart(4, "0");

  await tx.insert(wallets).values([
    { userId, currency: "USD", name: "Main account", balance: "1000.00", accountNumber: `IGW-USD-${suffix}-0001`, isPrimary: true },
    { userId, currency: "EUR", name: "Europe account", balance: "0.00", accountNumber: `IGW-EUR-${suffix}-0002`, isPrimary: false },
    { userId, currency: "GBP", name: "UK account", balance: "0.00", accountNumber: `IGW-GBP-${suffix}-0003`, isPrimary: false },
    { userId, currency: "TRY", name: "Turkey account", balance: "0.00", accountNumber: `IGW-TRY-${suffix}-0004`, isPrimary: false },
  ]);

  await tx.insert(cards).values({
    userId,
    label: "IGW Virtual",
    last4,
    brand: "Visa",
    type: "Virtual card",
    expiry: "09/30",
    status: "active",
    theme: "violet",
  });

  await tx.insert(recipients).values([
    { userId, name: "Elif Yilmaz", email: "elif@example.com", currency: "USD", walletId: null, color: "#7F00FF" },
    { userId, name: "Lena Fischer", email: "lena@example.com", currency: "EUR", walletId: null, color: "#19A2D3" },
    { userId, name: "Daniel Costa", email: "daniel@example.com", currency: "GBP", walletId: null, color: "#F59E0B" },
  ]);
}

/* ------------------------------------------------------------------ */
/* Dashboard assembly                                                  */
/* ------------------------------------------------------------------ */

const toWallet = (row: typeof wallets.$inferSelect): Wallet => ({
  id: row.id,
  currency: row.currency,
  name: row.name,
  balance: Number(row.balance),
  accountNumber: row.accountNumber,
  isPrimary: row.isPrimary,
});

function buildStats(dataWallets: Wallet[], rows: Transaction[]) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recent = rows.filter((row) => new Date(row.createdAt) >= thirtyDaysAgo);
  const sumUsd = (direction: "in" | "out") =>
    recent
      .filter((row) => row.direction === direction)
      .reduce(
        (total, row) =>
          total + row.amount * (CURRENCIES[row.currency]?.usd ?? 1),
        0,
      );

  return {
    totalUsd: dataWallets.reduce(
      (total, wallet) =>
        total + wallet.balance * (CURRENCIES[wallet.currency]?.usd ?? 1),
      0,
    ),
    moneyIn: sumUsd("in"),
    moneyOut: sumUsd("out"),
    currencyCount: dataWallets.length,
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const user = await requireSessionUser();

  const walletRows = await db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, user.id))
    .orderBy(wallets.id);

  const transactionRows = walletRows.length
    ? await db
        .select()
        .from(transactions)
        .where(inArray(transactions.walletId, walletRows.map((wallet) => wallet.id)))
        .orderBy(transactions.createdAt)
    : [];

  const cardRows = await db.select().from(cards).where(eq(cards.userId, user.id)).orderBy(cards.id);
  const recipientRows = await db.select().from(recipients).where(eq(recipients.userId, user.id)).orderBy(recipients.id);

  const mappedWallets = walletRows.map(toWallet);
  const mappedTransactions: Transaction[] = transactionRows.map((row) => ({
    id: row.id,
    type: row.type,
    direction: row.direction as "in" | "out",
    amount: Number(row.amount),
    currency: row.currency,
    counterparty: row.counterparty,
    note: row.note,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    user: {
      name: user.name,
      email: user.email,
      plan: user.plan,
      initials: initialsOf(user.name),
    },
    wallets: mappedWallets,
    transactions: mappedTransactions.slice(-30).reverse(),
    cards: cardRows.map((row) => ({
      id: row.id,
      label: row.label,
      last4: row.last4,
      brand: row.brand,
      type: row.type,
      expiry: row.expiry,
      status: row.status,
      theme: row.theme,
    })),
    recipients: recipientRows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      currency: row.currency,
      color: row.color,
      walletId: row.walletId,
    })),
    stats: buildStats(mappedWallets, mappedTransactions),
  };
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

const rate = (currency: string) => CURRENCIES[currency]?.usd ?? 1;
const convertAmount = (amount: number, from: string, to: string) =>
  Math.round(((amount * rate(from)) / rate(to)) * 100) / 100;

export async function executeAction(payload: ActionPayload): Promise<{ convertedAmount?: number }> {
  const user = await requireSessionUser();
  const amount = Math.round((payload.amount ?? 0) * 100) / 100;
  const note = (payload.note ?? "").slice(0, 200);

  if (payload.action === "toggleCard") {
    const [card] = await db
      .select()
      .from(cards)
      .where(and(eq(cards.id, payload.cardId ?? -1), eq(cards.userId, user.id)))
      .limit(1);
    if (!card) throw new Error("Card not found");
    await db
      .update(cards)
      .set({ status: card.status === "active" ? "frozen" : "active" })
      .where(and(eq(cards.id, card.id), eq(cards.userId, user.id)));
    return {};
  }

  if (!(amount > 0)) throw new Error("Enter a valid amount");

  const walletRows = await db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, user.id))
    .orderBy(wallets.id);

  if (payload.action === "send") {
    const [recipient] = await db
      .select()
      .from(recipients)
      .where(and(eq(recipients.id, payload.recipientId ?? -1), eq(recipients.userId, user.id)))
      .limit(1);
    if (!recipient) throw new Error("Recipient not found");

    const source =
      walletRows.find((wallet) => wallet.id === payload.walletId) ??
      walletRows.find((wallet) => wallet.currency === recipient.currency);
    if (!source) throw new Error("Wallet not found");

    const converted = convertAmount(amount, source.currency, recipient.currency);

    await db.transaction(async (tx) => {
      const [debited] = await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} - ${amount.toFixed(2)}` })
        .where(and(eq(wallets.id, source.id), eq(wallets.userId, user.id), gte(wallets.balance, amount.toFixed(2))))
        .returning({ id: wallets.id });
      if (!debited) throw new Error("Insufficient balance");

      if (recipient.walletId) {
        await tx
          .update(wallets)
          .set({ balance: sql`${wallets.balance} + ${converted.toFixed(2)}` })
          .where(eq(wallets.id, recipient.walletId));
      }

      const rows: (typeof transactions.$inferInsert)[] = [
        {
          walletId: source.id,
          type: "transfer",
          direction: "out",
          amount: amount.toFixed(2),
          currency: source.currency,
          counterparty: recipient.name,
          note,
        },
      ];
      if (recipient.walletId) {
        rows.push({
          walletId: recipient.walletId,
          type: "transfer",
          direction: "in",
          amount: converted.toFixed(2),
          currency: recipient.currency,
          counterparty: user.name,
          note,
        });
      }
      await tx.insert(transactions).values(rows);
    });
    return { convertedAmount: converted };
  }

  const wallet = walletRows.find((row) => row.id === payload.walletId);
  if (!wallet) throw new Error("Wallet not found");

  if (payload.action === "topup") {
    await db.transaction(async (tx) => {
      await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} + ${amount.toFixed(2)}` })
        .where(and(eq(wallets.id, wallet.id), eq(wallets.userId, user.id)));
      await tx.insert(transactions).values({
        walletId: wallet.id,
        type: "topup",
        direction: "in",
        amount: amount.toFixed(2),
        currency: wallet.currency,
        counterparty: payload.method || "Bank card",
        note: note || "Top up",
      });
    });
    return {};
  }

  if (payload.action === "withdraw") {
    await db.transaction(async (tx) => {
      const [debited] = await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} - ${amount.toFixed(2)}` })
        .where(and(eq(wallets.id, wallet.id), eq(wallets.userId, user.id), gte(wallets.balance, amount.toFixed(2))))
        .returning({ id: wallets.id });
      if (!debited) throw new Error("Insufficient balance");
      await tx.insert(transactions).values({
        walletId: wallet.id,
        type: "withdraw",
        direction: "out",
        amount: amount.toFixed(2),
        currency: wallet.currency,
        counterparty: payload.method || "Bank account",
        note: note || "Withdrawal",
      });
    });
    return {};
  }

  if (payload.action === "exchange") {
    const target = walletRows.find((row) => row.id === payload.targetWalletId);
    if (!target || target.id === wallet.id) throw new Error("Invalid target wallet");
    const converted = convertAmount(amount, wallet.currency, target.currency);

    await db.transaction(async (tx) => {
      const [debited] = await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} - ${amount.toFixed(2)}` })
        .where(and(eq(wallets.id, wallet.id), eq(wallets.userId, user.id), gte(wallets.balance, amount.toFixed(2))))
        .returning({ id: wallets.id });
      if (!debited) throw new Error("Insufficient balance");
      await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} + ${converted.toFixed(2)}` })
        .where(and(eq(wallets.id, target.id), eq(wallets.userId, user.id)));
      const pair = `${wallet.currency} → ${target.currency}`;
      await tx.insert(transactions).values([
        { walletId: wallet.id, type: "exchange", direction: "out", amount: amount.toFixed(2), currency: wallet.currency, counterparty: pair, note: "Currency exchange" },
        { walletId: target.id, type: "exchange", direction: "in", amount: converted.toFixed(2), currency: target.currency, counterparty: pair, note: "Currency exchange" },
      ]);
    });
    return { convertedAmount: converted };
  }

  throw new Error("Unknown action");
}
