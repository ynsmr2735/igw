import { cookies } from "next/headers";
import { and, eq, gte, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  cards,
  recipients,
  transactions,
  users,
  wallets,
} from "@/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { CURRENCIES, initialsOf } from "./format";

export {
  CURRENCIES,
  convert,
  formatDate,
  formatMoney,
  initialsOf,
} from "./format";

export const DEMO_EMAIL = "deniz@instaglobalwallet.com";
const DEMO_COOKIE = "igw_demo_user";

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
  mode: "supabase" | "demo";
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

type Identity =
  | { mode: "supabase"; userId: string; email: string; name: string; plan: string }
  | { mode: "demo"; email: string; name: string; plan: string };

const daysAgo = (days: number, hour = 10) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 20, 0, 0);
  return date;
};

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

async function getIdentity(): Promise<Identity> {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id,full_name,email,plan")
          .eq("id", data.user.id)
          .maybeSingle();
        const row = profile as
          | { id: string; full_name: string; email: string; plan: string }
          | null;
        return {
          mode: "supabase",
          userId: data.user.id,
          email: row?.email ?? data.user.email ?? "",
          name:
            row?.full_name ??
            String(data.user.user_metadata?.full_name ?? "IGW Member"),
          plan: row?.plan ?? "Global Plus",
        };
      }
    }
  }

  const cookieStore = await cookies();
  const raw = cookieStore.get(DEMO_COOKIE)?.value;
  if (raw) {
    try {
      const parsed = JSON.parse(
        Buffer.from(raw, "base64url").toString("utf8"),
      ) as { name: string; email: string };
      if (parsed.email) {
        return { mode: "demo", email: parsed.email, name: parsed.name, plan: "Global Plus" };
      }
    } catch {
      // Fall through to the seeded demo account.
    }
  }

  return { mode: "demo", email: DEMO_EMAIL, name: "Deniz Arslan", plan: "Global Plus" };
}

/* ------------------------------------------------------------------ */
/* Local demo seed                                                     */
/* ------------------------------------------------------------------ */

export async function ensureSeed(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(918273645)`);
    const existing = await tx.select({ id: users.id }).from(users).limit(1);
    if (existing.length > 0) return;

    const insertedUsers = await tx
      .insert(users)
      .values([
        { name: "Deniz Arslan", email: DEMO_EMAIL, plan: "Global Plus" },
        { name: "Elif Yilmaz", email: "elif@example.com", plan: "Global" },
        { name: "Lena Fischer", email: "lena@example.com", plan: "Global" },
        { name: "Daniel Costa", email: "daniel@example.com", plan: "Global" },
        { name: "Mert Kaya", email: "mert@example.com", plan: "Global" },
      ])
      .returning();

    const [deniz, elif, lena, daniel, mert] = insertedUsers;

    const insertedWallets = await tx
      .insert(wallets)
      .values([
        { userId: deniz.id, currency: "USD", name: "Main account", balance: "8420.50", accountNumber: "IGW-USD-4820-7731", isPrimary: true },
        { userId: deniz.id, currency: "EUR", name: "Europe account", balance: "3180.25", accountNumber: "IGW-EUR-9021-4482", isPrimary: false },
        { userId: deniz.id, currency: "GBP", name: "UK account", balance: "1240.00", accountNumber: "IGW-GBP-3378-1109", isPrimary: false },
        { userId: deniz.id, currency: "TRY", name: "Turkey account", balance: "24650.00", accountNumber: "IGW-TRY-7742-9056", isPrimary: false },
        { userId: elif.id, currency: "USD", name: "USD account", balance: "940.00", accountNumber: "IGW-USD-1188-2231", isPrimary: true },
        { userId: lena.id, currency: "EUR", name: "EUR account", balance: "620.00", accountNumber: "IGW-EUR-3344-5566", isPrimary: true },
        { userId: daniel.id, currency: "GBP", name: "GBP account", balance: "410.00", accountNumber: "IGW-GBP-7788-9900", isPrimary: true },
        { userId: mert.id, currency: "TRY", name: "TRY account", balance: "3200.00", accountNumber: "IGW-TRY-1122-3344", isPrimary: true },
      ])
      .returning();

    const own = insertedWallets.filter((wallet) => wallet.userId === deniz.id);
    const contactWallet = (index: number) => insertedWallets[index + 4];

    await tx.insert(recipients).values([
      { userId: deniz.id, name: "Elif Yilmaz", email: elif.email, currency: "USD", walletId: contactWallet(0).id, color: "#7F00FF" },
      { userId: deniz.id, name: "Lena Fischer", email: lena.email, currency: "EUR", walletId: contactWallet(1).id, color: "#19A2D3" },
      { userId: deniz.id, name: "Daniel Costa", email: daniel.email, currency: "GBP", walletId: contactWallet(2).id, color: "#F59E0B" },
      { userId: deniz.id, name: "Mert Kaya", email: mert.email, currency: "TRY", walletId: contactWallet(3).id, color: "#10B981" },
    ]);

    await tx.insert(cards).values([
      { userId: deniz.id, label: "IGW Virtual", last4: "4291", brand: "Visa", type: "Virtual card", expiry: "09/29", status: "active", theme: "violet" },
      { userId: deniz.id, label: "IGW Metal", last4: "8803", brand: "Mastercard", type: "Physical card", expiry: "04/28", status: "active", theme: "midnight" },
      { userId: deniz.id, label: "Gift Card", last4: "6127", brand: "Visa", type: "Gift card", expiry: "12/27", status: "frozen", theme: "cyan" },
    ]);

    const [usd, eur, gbp, tryWallet] = own;

    await tx.insert(transactions).values([
      { walletId: usd.id, type: "transfer", direction: "out", amount: "250.00", currency: "USD", counterparty: "Elif Yilmaz", note: "Rent share", createdAt: daysAgo(0, 9) },
      { walletId: eur.id, type: "payment", direction: "out", amount: "42.90", currency: "EUR", counterparty: "Spotify Premium", note: "Monthly subscription", createdAt: daysAgo(0, 8) },
      { walletId: usd.id, type: "transfer", direction: "in", amount: "1250.00", currency: "USD", counterparty: "Nova Studio", note: "Project payment", createdAt: daysAgo(1, 15) },
      { walletId: tryWallet.id, type: "payment", direction: "out", amount: "780.00", currency: "TRY", counterparty: "Migros", note: "Groceries", createdAt: daysAgo(2, 13) },
      { walletId: gbp.id, type: "withdraw", direction: "out", amount: "180.00", currency: "GBP", counterparty: "My bank account", note: "Bank transfer", createdAt: daysAgo(3, 11) },
      { walletId: usd.id, type: "topup", direction: "in", amount: "900.00", currency: "USD", counterparty: "Visa •••• 3910", note: "Top up", createdAt: daysAgo(4, 10) },
      { walletId: eur.id, type: "transfer", direction: "out", amount: "120.00", currency: "EUR", counterparty: "Lena Fischer", note: "Dinner", createdAt: daysAgo(5, 20) },
      { walletId: usd.id, type: "exchange", direction: "in", amount: "300.00", currency: "USD", counterparty: "USD → EUR", note: "Currency exchange", createdAt: daysAgo(6, 12) },
      { walletId: eur.id, type: "exchange", direction: "out", amount: "277.78", currency: "EUR", counterparty: "USD → EUR", note: "Currency exchange", createdAt: daysAgo(6, 12) },
      { walletId: usd.id, type: "reward", direction: "in", amount: "24.50", currency: "USD", counterparty: "IGW Rewards", note: "Cashback", createdAt: daysAgo(8, 16) },
      { walletId: tryWallet.id, type: "transfer", direction: "in", amount: "5400.00", currency: "TRY", counterparty: "Mert Kaya", note: "Event expenses", createdAt: daysAgo(10, 14) },
      { walletId: usd.id, type: "payment", direction: "out", amount: "89.99", currency: "USD", counterparty: "Adobe Creative Cloud", note: "Subscription", createdAt: daysAgo(12, 9) },
    ]);
  });
}

export async function ensureLocalProfile(email: string, name: string): Promise<void> {
  await ensureSeed();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) return;

  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ name, email, plan: "Global Plus" })
      .onConflictDoNothing()
      .returning();
    if (!user) return;

    await tx.insert(wallets).values([
      { userId: user.id, currency: "USD", name: "Main account", balance: "1000.00", accountNumber: `IGW-USD-${suffix}-0001`, isPrimary: true },
      { userId: user.id, currency: "EUR", name: "Europe account", balance: "0.00", accountNumber: `IGW-EUR-${suffix}-0002`, isPrimary: false },
      { userId: user.id, currency: "GBP", name: "UK account", balance: "0.00", accountNumber: `IGW-GBP-${suffix}-0003`, isPrimary: false },
      { userId: user.id, currency: "TRY", name: "Turkey account", balance: "0.00", accountNumber: `IGW-TRY-${suffix}-0004`, isPrimary: false },
    ]);
    await tx.insert(cards).values({
      userId: user.id,
      label: "IGW Virtual",
      last4: suffix.slice(0, 4),
      brand: "Visa",
      type: "Virtual card",
      expiry: "09/30",
      status: "active",
      theme: "violet",
    });
    await tx.insert(recipients).values([
      { userId: user.id, name: "Elif Yilmaz", email: "elif@example.com", currency: "USD", walletId: null, color: "#7F00FF" },
      { userId: user.id, name: "Lena Fischer", email: "lena@example.com", currency: "EUR", walletId: null, color: "#19A2D3" },
      { userId: user.id, name: "Daniel Costa", email: "daniel@example.com", currency: "GBP", walletId: null, color: "#F59E0B" },
    ]);
  });
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

async function getDemoDashboard(identity: Extract<Identity, { mode: "demo" }>): Promise<DashboardData> {
  await ensureLocalProfile(identity.email, identity.name);

  const [user] = await db.select().from(users).where(eq(users.email, identity.email)).limit(1);
  if (!user) throw new Error("Demo user could not be created");

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
      plan: "Global Plus",
      initials: initialsOf(user.name),
    },
    mode: "demo",
    wallets: walletRows.map(toWallet),
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
    stats: buildStats(walletRows.map(toWallet), mappedTransactions),
  };
}

type SupWallet = { id: number; currency: string; name: string; balance: string | number; account_number: string; is_primary: boolean };
type SupTransaction = { id: number; type: string; direction: string; amount: string | number; currency: string; counterparty: string; note: string | null; status: string; created_at: string };
type SupCard = { id: number; label: string; last4: string; brand: string; type: string; expiry: string; status: string; theme: string };
type SupRecipient = { id: number; name: string; email: string; currency: string; color: string; wallet_id: number | null };

async function getSupabaseDashboard(identity: Extract<Identity, { mode: "supabase" }>): Promise<DashboardData> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const { data: walletData } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", identity.userId)
    .order("id");
  const walletRows = (walletData ?? []) as SupWallet[];

  const walletIds = walletRows.map((wallet) => wallet.id);
  const { data: transactionData } = walletIds.length
    ? await supabase
        .from("transactions")
        .select("*")
        .in("wallet_id", walletIds)
        .order("created_at", { ascending: true })
    : { data: [] };
  const { data: cardData } = await supabase
    .from("cards")
    .select("*")
    .eq("user_id", identity.userId)
    .order("id");
  const { data: recipientData } = await supabase
    .from("recipients")
    .select("*")
    .eq("user_id", identity.userId)
    .order("id");

  const mappedWallets: Wallet[] = walletRows.map((row) => ({
    id: row.id,
    currency: row.currency,
    name: row.name,
    balance: Number(row.balance),
    accountNumber: row.account_number,
    isPrimary: row.is_primary,
  }));

  const mappedTransactions: Transaction[] = ((transactionData ?? []) as SupTransaction[]).map((row) => ({
    id: row.id,
    type: row.type,
    direction: row.direction as "in" | "out",
    amount: Number(row.amount),
    currency: row.currency,
    counterparty: row.counterparty,
    note: row.note ?? "",
    status: row.status,
    createdAt: row.created_at,
  }));

  return {
    user: {
      name: identity.name,
      email: identity.email,
      plan: identity.plan,
      initials: initialsOf(identity.name),
    },
    mode: "supabase",
    wallets: mappedWallets,
    transactions: mappedTransactions.slice(-30).reverse(),
    cards: ((cardData ?? []) as SupCard[]).map((row) => ({
      id: row.id,
      label: row.label,
      last4: row.last4,
      brand: row.brand,
      type: row.type,
      expiry: row.expiry,
      status: row.status,
      theme: row.theme,
    })),
    recipients: ((recipientData ?? []) as SupRecipient[]).map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      currency: row.currency,
      color: row.color,
      walletId: row.wallet_id,
    })),
    stats: buildStats(mappedWallets, mappedTransactions),
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const identity = await getIdentity();
  return identity.mode === "supabase"
    ? getSupabaseDashboard(identity)
    : getDemoDashboard(identity);
}

export async function getOwnWallets(): Promise<Wallet[]> {
  const identity = await getIdentity();
  if (identity.mode === "supabase") {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return [];
    const { data } = await supabase
      .from("wallets")
      .select("*")
      .eq("user_id", identity.userId)
      .order("id");
    return ((data ?? []) as SupWallet[]).map((row) => ({
      id: row.id,
      currency: row.currency,
      name: row.name,
      balance: Number(row.balance),
      accountNumber: row.account_number,
      isPrimary: row.is_primary,
    }));
  }

  await ensureLocalProfile(identity.email, identity.name);
  const [user] = await db.select().from(users).where(eq(users.email, identity.email)).limit(1);
  if (!user) return [];
  const rows = await db.select().from(wallets).where(eq(wallets.userId, user.id)).orderBy(wallets.id);
  return rows.map(toWallet);
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export async function executeAction(payload: ActionPayload): Promise<{ convertedAmount?: number }> {
  const identity = await getIdentity();

  if (identity.mode === "supabase") {
    const supabase = await createSupabaseServerClient();
    if (!supabase) throw new Error("Supabase is not configured");
    const { data, error } = await supabase.rpc("execute_wallet_action", {
      p_action: payload.action,
      p_amount: payload.amount ?? 0,
      p_wallet_id: payload.walletId ?? null,
      p_target_wallet_id: payload.targetWalletId ?? null,
      p_recipient_id: payload.recipientId ?? null,
      p_card_id: payload.cardId ?? null,
      p_note: payload.note ?? "",
      p_method: payload.method ?? "",
    });
    if (error) throw new Error(error.message);
    const result = data as { ok?: boolean; converted_amount?: number; error?: string } | null;
    if (!result?.ok) throw new Error(result?.error ?? "Transaction failed");
    return { convertedAmount: result.converted_amount };
  }

  return executeLocalAction(payload, identity.email, identity.name);
}

async function executeLocalAction(
  payload: ActionPayload,
  email: string,
  name: string,
): Promise<{ convertedAmount?: number }> {
  await ensureLocalProfile(email, name);
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error("User not found");

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
      .where(eq(cards.id, card.id));
    return {};
  }

  if (payload.action === "send") {
    const [recipient] = await db
      .select()
      .from(recipients)
      .where(and(eq(recipients.id, payload.recipientId ?? -1), eq(recipients.userId, user.id)))
      .limit(1);
    if (!recipient) throw new Error("Recipient not found");

    const sourceWalletList = await db
      .select()
      .from(wallets)
      .where(eq(wallets.userId, user.id))
      .orderBy(wallets.id);
    const source =
      sourceWalletList.find((wallet) => wallet.id === payload.walletId) ??
      sourceWalletList.find((wallet) => wallet.currency === recipient.currency);
    if (!source) throw new Error("Wallet not found");

    const converted =
      Math.round(
        (amount *
          (CURRENCIES[source.currency]?.usd ?? 1)) /
          (CURRENCIES[recipient.currency]?.usd ?? 1) *
          100,
      ) / 100;

    await db.transaction(async (tx) => {
      const [debited] = await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} - ${amount.toFixed(2)}` })
        .where(and(eq(wallets.id, source.id), gte(wallets.balance, amount.toFixed(2))))
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
          counterparty: name,
          note,
        });
      }
      await tx.insert(transactions).values(rows);
    });
    return { convertedAmount: converted };
  }

  const walletRows = await db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, user.id))
    .orderBy(wallets.id);
  const wallet = walletRows.find((row) => row.id === payload.walletId);
  if (!wallet) throw new Error("Wallet not found");

  if (payload.action === "topup") {
    await db.transaction(async (tx) => {
      await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} + ${amount.toFixed(2)}` })
        .where(eq(wallets.id, wallet.id));
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
        .where(and(eq(wallets.id, wallet.id), gte(wallets.balance, amount.toFixed(2))))
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
    const converted =
      Math.round(
        (amount * (CURRENCIES[wallet.currency]?.usd ?? 1)) /
          (CURRENCIES[target.currency]?.usd ?? 1) *
          100,
      ) / 100;

    await db.transaction(async (tx) => {
      const [debited] = await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} - ${amount.toFixed(2)}` })
        .where(and(eq(wallets.id, wallet.id), gte(wallets.balance, amount.toFixed(2))))
        .returning({ id: wallets.id });
      if (!debited) throw new Error("Insufficient balance");
      await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} + ${converted.toFixed(2)}` })
        .where(eq(wallets.id, target.id));
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
