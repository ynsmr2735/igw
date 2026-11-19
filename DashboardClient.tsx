"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  CreditCard,
  Download,
  Gift,
  Globe2,
  HelpCircle,
  Landmark,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  LogOut,
  Menu,
  Plus,
  Repeat2,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UnlockKeyhole,
  Users,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Brand } from "@/components/Brand";
import { signOutAction } from "@/app/auth/actions";
import { CURRENCIES, convert, formatDate, formatMoney } from "@/lib/format";
import type { Card, DashboardData, Transaction } from "@/lib/wallet";

type ActionKey = "send" | "topup" | "withdraw" | "exchange" | null;

type FormState = {
  recipientId: string;
  walletId: string;
  targetWalletId: string;
  amount: string;
  note: string;
  method: string;
};

const emptyForm: FormState = {
  recipientId: "",
  walletId: "",
  targetWalletId: "",
  amount: "",
  note: "",
  method: "Bank card •••• 3910",
};

const navItems: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "wallets", label: "My Wallets", icon: Wallet },
  { id: "transactions", label: "Transactions", icon: ArrowLeftRight },
  { id: "cards", label: "My Cards", icon: CreditCard },
  { id: "recipients", label: "Recipients", icon: Users },
  { id: "settings", label: "Settings", icon: Settings },
];

const txMeta: Record<
  string,
  { label: string; icon: LucideIcon; bg: string; color: string }
> = {
  transfer: { label: "Transfer", icon: ArrowUpRight, bg: "bg-purple-50", color: "text-[#7F00FF]" },
  payment: { label: "Payment", icon: CreditCard, bg: "bg-cyan-50", color: "text-cyan-600" },
  topup: { label: "Top up", icon: Plus, bg: "bg-emerald-50", color: "text-emerald-600" },
  withdraw: { label: "Withdrawal", icon: Landmark, bg: "bg-amber-50", color: "text-amber-600" },
  exchange: { label: "Exchange", icon: Repeat2, bg: "bg-blue-50", color: "text-blue-600" },
  reward: { label: "Reward", icon: Gift, bg: "bg-pink-50", color: "text-pink-600" },
};

const quickActions: { key: Exclude<ActionKey, null>; label: string; icon: LucideIcon; tone: string }[] = [
  { key: "send", label: "Send Money", icon: Send, tone: "from-violet-500 to-purple-700" },
  { key: "topup", label: "Top Up", icon: Plus, tone: "from-cyan-400 to-blue-600" },
  { key: "withdraw", label: "Withdraw", icon: Download, tone: "from-emerald-400 to-teal-600" },
  { key: "exchange", label: "Exchange", icon: Repeat2, tone: "from-amber-400 to-orange-600" },
];

function TransactionRow({ item }: { item: Transaction }) {
  const meta = txMeta[item.type] ?? txMeta.transfer;
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-3 border-b border-slate-50 px-4 py-3.5 transition last:border-0 hover:bg-slate-50/70 sm:px-5">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${meta.bg} ${meta.color}`}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold text-[#10152b]">{item.counterparty}</p>
        <p className="mt-0.5 truncate text-[11px] text-slate-400">
          {meta.label} · {formatDate(item.createdAt)}
        </p>
      </div>
      <div className="text-right">
        <p className={`text-[13px] font-black ${item.direction === "in" ? "text-emerald-600" : "text-[#10152b]"}`}>
          {item.direction === "in" ? "+" : "−"}
          {formatMoney(item.amount, item.currency)}
        </p>
        <p className="mt-0.5 text-[10px] font-semibold text-slate-400">
          {item.status === "completed" ? "Completed" : item.status}
        </p>
      </div>
    </div>
  );
}

function BankCard({ card, onToggle }: { card: Card; onToggle: (id: number) => void }) {
  const theme =
    card.theme === "midnight"
      ? "bg-[#151a32]"
      : card.theme === "cyan"
        ? "bg-gradient-to-br from-cyan-500 to-blue-600"
        : "igw-gradient";

  return (
    <div className={`igw-card-shine relative overflow-hidden rounded-[24px] p-5 text-white shadow-[0_24px_50px_-24px_rgba(16,21,43,0.7)] ${theme}`}>
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-white/60">Insta Global Wallet</p>
          <p className="mt-1 text-base font-black">{card.label}</p>
        </div>
        <span className="text-xs font-black italic">{card.brand}</span>
      </div>
      <div className="relative mt-8 flex items-center gap-2">
        <span className="h-6 w-8 rounded-full bg-yellow-300/90" />
        <span className="-ml-4 h-6 w-8 rounded-full bg-white/70" />
      </div>
      <p className="relative mt-5 font-mono text-[15px] tracking-[0.18em]">•••• •••• •••• {card.last4}</p>
      <div className="relative mt-4 flex items-end justify-between">
        <div>
          <p className="text-[9px] uppercase tracking-widest text-white/60">Son kullanma</p>
          <p className="text-xs font-bold">{card.expiry}</p>
        </div>
        <button
          onClick={() => onToggle(card.id)}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold backdrop-blur transition ${
            card.status === "active" ? "bg-white/15 text-white hover:bg-white/25" : "bg-rose-500/90 text-white"
          }`}
        >
          {card.status === "active" ? <LockKeyhole className="h-3 w-3" /> : <UnlockKeyhole className="h-3 w-3" />}
          {card.status === "active" ? "Freeze" : "Activate"}
        </button>
      </div>
    </div>
  );
}

export default function DashboardClient({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState(initialData);
  const [activeNav, setActiveNav] = useState("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [action, setAction] = useState<ActionKey>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ type: "ok" | "error"; message: string } | null>(null);
  const [filter, setFilter] = useState<"all" | "in" | "out">("all");
  const [search, setSearch] = useState("");
  const [switches, setSwitches] = useState({ push: true, email: false, security: true });

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(timer);
  }, [toast]);

  async function refresh() {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    if (response.ok) setData((await response.json()) as DashboardData);
  }

  function goTo(id: string) {
    setActiveNav(id);
    setMobileOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openAction(next: Exclude<ActionKey, null>) {
    const firstRecipient = data.recipients[0];
    const matchingWallet = data.wallets.find(
      (wallet) => wallet.currency === firstRecipient?.currency,
    );
    setForm({
      ...emptyForm,
      recipientId: firstRecipient?.id.toString() ?? "",
      walletId: (matchingWallet ?? data.wallets[0])?.id.toString() ?? "",
      targetWalletId: data.wallets[1]?.id.toString() ?? data.wallets[0]?.id.toString() ?? "",
    });
    setAction(next);
  }

  const selectedWallet = data.wallets.find((wallet) => wallet.id === Number(form.walletId));
  const targetWallet = data.wallets.find((wallet) => wallet.id === Number(form.targetWalletId));
  const selectedRecipient = data.recipients.find(
    (recipient) => recipient.id === Number(form.recipientId),
  );
  const amountValue = Number(form.amount);

  const preview =
    action === "send" && selectedWallet && selectedRecipient && amountValue > 0
      ? convert(amountValue, selectedWallet.currency, selectedRecipient.currency)
      : action === "exchange" && selectedWallet && targetWallet && amountValue > 0
        ? convert(amountValue, selectedWallet.currency, targetWallet.currency)
        : null;

  async function submitAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) return;
    if (!amountValue || amountValue <= 0) {
      setToast({ type: "error", message: "Please enter a valid amount." });
      return;
    }
    if ((action === "send" || action === "withdraw" || action === "exchange") && selectedWallet && amountValue > selectedWallet.balance) {
      setToast({ type: "error", message: "Insufficient balance in this wallet." });
      return;
    }
    if (action === "exchange" && form.walletId === form.targetWalletId) {
      setToast({ type: "error", message: "Choose a different target wallet." });
      return;
    }

    const payload: Record<string, string | number> = {
      action,
      amount: amountValue,
      note: form.note,
      walletId: Number(form.walletId),
    };
    if (action === "send") payload.recipientId = Number(form.recipientId);
    if (action === "exchange") payload.targetWalletId = Number(form.targetWalletId);
    if (action === "topup" || action === "withdraw") payload.method = form.method;

    setLoading(true);
    try {
      const response = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Transaction failed");
      await refresh();
      setAction(null);
      const messages: Record<string, string> = {
        send: "Transfer completed successfully.",
        topup: "Your balance was topped up.",
        withdraw: "Your withdrawal was completed.",
        exchange: "Your exchange was completed.",
      };
      setToast({ type: "ok", message: messages[action] });
    } catch (error) {
      setToast({
        type: "error",
        message: error instanceof Error ? error.message : "Transaction failed",
      });
    } finally {
      setLoading(false);
    }
  }

  async function toggleCard(cardId: number) {
    try {
      const response = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggleCard", cardId }),
      });
      if (!response.ok) throw new Error("Card could not be updated");
      await refresh();
      setToast({ type: "ok", message: "Card status updated." });
    } catch {
      setToast({ type: "error", message: "Card status could not be updated." });
    }
  }

  async function copyAccount(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setToast({ type: "ok", message: "Account number copied." });
    } catch {
      setToast({ type: "error", message: "Could not copy." });
    }
  }

  const visibleTransactions = useMemo(
    () =>
      data.transactions.filter((item) => {
        const matchesDirection = filter === "all" || item.direction === filter;
        const haystack = `${item.counterparty} ${item.note} ${item.currency}`.toLocaleLowerCase("tr");
        return matchesDirection && haystack.includes(search.toLocaleLowerCase("tr"));
      }),
    [data.transactions, filter, search],
  );

  const donutSegments = useMemo(() => {
    const total = data.stats.totalUsd || 1;
    const palette = ["#7F00FF", "#19A2D3", "#F59E0B", "#10B981"];
    let cursor = 0;
    return data.wallets.map((wallet, index) => {
      const percent =
        ((wallet.balance * (CURRENCIES[wallet.currency]?.usd ?? 1)) / total) * 100;
      const segment = `${palette[index % palette.length]} ${cursor}% ${cursor + percent}%`;
      cursor += percent;
      return segment;
    });
  }, [data.wallets, data.stats.totalUsd]);

  const actionTitles: Record<Exclude<ActionKey, null>, { title: string; subtitle: string }> = {
    send: { title: "Send money", subtitle: "Pick a recipient, enter an amount and transfer instantly." },
    topup: { title: "Top up balance", subtitle: "Add money to your wallet quickly and safely." },
    withdraw: { title: "Withdraw money", subtitle: "Move your balance to a bank account." },
    exchange: { title: "Exchange currency", subtitle: "Swap between your currencies instantly." },
  };

  return (
    <div className="min-h-screen bg-[#f7f7fb] text-[#10152b]">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r border-white/5 bg-[#10152b] text-white transition-transform duration-300 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-[76px] items-center justify-between border-b border-white/5 px-6">
          <Brand dark compact href="/dashboard" />
          <button className="text-white/60 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1.5 overflow-y-auto px-4 py-6 scrollbar-thin">
          <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/30">Menu</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => goTo(item.id)}
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-semibold transition ${
                  active
                    ? "igw-gradient text-white shadow-[0_10px_24px_-10px_rgba(127,0,255,0.9)]"
                    : "text-white/55 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" />
                {item.label}
                {active && <ChevronRight className="ml-auto h-4 w-4 opacity-70" />}
              </button>
            );
          })}

          <p className="mb-3 mt-8 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/30">Quick access</p>
          <button
            onClick={() => openAction("send")}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-semibold text-white/55 transition hover:bg-white/5 hover:text-white"
          >
            <Send className="h-[18px] w-[18px]" /> Yeni transfer
          </button>
          <Link
            href="/"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-semibold text-white/55 transition hover:bg-white/5 hover:text-white"
          >
            <Globe2 className="h-[18px] w-[18px]" /> Home page
          </Link>
        </nav>

        <div className="p-4">
          <div className="relative overflow-hidden rounded-2xl igw-gradient p-4">
            <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-white/15 blur-xl" />
            <div className="relative">
              <Sparkles className="h-5 w-5 text-white" />
              <p className="mt-3 text-[13px] font-bold">IGW Global Plus</p>
              <p className="mt-1 text-[11px] leading-5 text-white/75">
                Enjoy unlimited transfers and special exchange rates.
              </p>
              <button onClick={() => goTo("settings")} className="mt-3 text-[11px] font-bold text-white underline underline-offset-4">
                View benefits
              </button>
            </div>
          </div>
          <div className="mt-4 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-[12px] font-semibold text-white/60">
            <span className="flex h-9 w-9 items-center justify-center rounded-full igw-gradient text-[11px] font-black text-white">
              {data.user.initials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-white">{data.user.name}</span>
              <span className="block truncate text-[10px] font-normal text-white/40">{data.user.email}</span>
            </span>
            <span className="h-2 w-2 rounded-full bg-emerald-400" title="Signed in" />
          </div>
          <form action={signOutAction}>
            <button type="submit" className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[12px] font-semibold text-white/50 transition hover:bg-white/5 hover:text-white">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </form>
        </div>
      </aside>

      {mobileOpen && (
        <button
          className="fixed inset-0 z-40 bg-[#10152b]/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        />
      )}

      {/* Main area */}
      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur-xl">
          <div className="flex h-[76px] items-center gap-4 px-4 sm:px-8">
            <button className="text-slate-600 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden min-w-0 sm:block">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Insta Global Wallet</p>
              <p className="truncate text-sm font-extrabold text-[#10152b]">
                {navItems.find((item) => item.id === activeNav)?.label ?? "Overview"}
              </p>
            </div>
            <div className="relative ml-auto hidden w-full max-w-xs lg:block">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setActiveNav("transactions");
                }}
                placeholder="Search transactions or recipients..."
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-[12px] font-medium text-slate-700 transition focus:border-purple-400 focus:bg-white focus:ring-2 focus:ring-purple-100"
              />
            </div>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <button className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:text-[#7F00FF]" aria-label="Notifications">
                <Bell className="h-[18px] w-[18px]" />
                <span className="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-[#7F00FF]" />
              </button>
              <button className="hidden h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:text-[#7F00FF] sm:flex" aria-label="Help">
                <HelpCircle className="h-[18px] w-[18px]" />
              </button>
              <span className="ml-1 flex h-10 w-10 items-center justify-center rounded-xl igw-gradient text-[11px] font-black text-white">
                {data.user.initials}
              </span>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] space-y-7 px-4 py-8 sm:px-8">
          {/* Greeting */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#7F00FF]">
                <Zap className="h-3.5 w-3.5" /> Financial overview
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-black tracking-normal text-emerald-600">
                  Secure session
                </span>
              </p>
              <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Merhaba, {data.user.name.split(" ")[0]} 👋</h1>
              <p className="mt-1 text-[13px] text-slate-500">Everything in your wallet on one screen, fully under your control.</p>
            </div>
            <button
              onClick={() => openAction("send")}
              className="igw-gradient inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[13px] font-bold text-white shadow-[0_14px_30px_-12px_rgba(127,0,255,0.9)] transition hover:-translate-y-0.5"
            >
              <Send className="h-4 w-4" /> Send money
            </button>
          </div>

          {/* Overview */}
          <section id="overview" className="grid gap-5 scroll-mt-28 lg:grid-cols-[1.5fr_1fr_1fr]">
            <div className="relative overflow-hidden rounded-[26px] igw-gradient p-6 text-white igw-shadow sm:p-7">
              <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-white/15 blur-2xl" />
              <div className="relative flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">Total balance</p>
                  <p className="mt-3 text-[clamp(2rem,3.4vw,2.9rem)] font-black tracking-tight">
                    {formatMoney(data.stats.totalUsd, "USD")}
                  </p>
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-emerald-100">
                    <TrendingUp className="h-3.5 w-3.5" /> Combined value of all wallets (USD equivalent)
                  </p>
                </div>
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
                  <Wallet className="h-5 w-5" />
                </span>
              </div>
              <div className="relative mt-8 flex flex-wrap gap-2.5">
                <button onClick={() => openAction("topup")} className="rounded-xl bg-white px-4 py-2.5 text-[11px] font-bold text-[#7F00FF] transition hover:-translate-y-0.5">
                  + Top up
                </button>
                <button onClick={() => openAction("exchange")} className="rounded-xl bg-white/15 px-4 py-2.5 text-[11px] font-bold text-white backdrop-blur transition hover:bg-white/25">
                  Exchange currency
                </button>
              </div>
            </div>

            <div className="rounded-[26px] border border-slate-100 bg-white p-6 igw-shadow-soft">
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                  <ArrowDownLeft className="h-5 w-5" />
                </span>
                <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-600">
                  <TrendingUp className="h-3 w-3" /> %12,4
                </span>
              </div>
              <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Incoming · last 30 days</p>
              <p className="mt-1 text-2xl font-black tracking-tight">{formatMoney(data.stats.moneyIn, "USD")}</p>
              <p className="mt-2 text-[11px] text-slate-400">Total in USD</p>
            </div>

            <div className="rounded-[26px] border border-slate-100 bg-white p-6 igw-shadow-soft">
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-purple-50 text-[#7F00FF]">
                  <ArrowUpRight className="h-5 w-5" />
                </span>
                <span className="flex items-center gap-1 rounded-full bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-500">
                  <TrendingDown className="h-3 w-3" /> %3,1
                </span>
              </div>
              <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Outgoing · last 30 days</p>
              <p className="mt-1 text-2xl font-black tracking-tight">{formatMoney(data.stats.moneyOut, "USD")}</p>
              <p className="mt-2 text-[11px] text-slate-400">Total in USD</p>
            </div>
          </section>

          {/* Quick actions + wallets */}
          <section className="grid gap-5 xl:grid-cols-[0.85fr_2.15fr]">
            <div className="rounded-[26px] border border-slate-100 bg-white p-5 igw-shadow-soft">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Quick actions</p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2">
                {quickActions.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      onClick={() => openAction(item.key)}
                      className="group flex flex-col items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50/60 p-4 transition hover:-translate-y-0.5 hover:border-purple-200 hover:bg-white"
                    >
                      <span className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${item.tone} text-white shadow-md`}>
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      <span className="text-[11px] font-bold text-slate-700">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div id="wallets" className="scroll-mt-28">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-black tracking-tight">My currencies</h2>
                <span className="text-[11px] font-semibold text-slate-400">{data.wallets.length} active wallets</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {data.wallets.map((wallet, index) => {
                  const colors = [
                    "from-violet-500 to-purple-700",
                    "from-cyan-400 to-blue-600",
                    "from-amber-400 to-orange-600",
                    "from-emerald-400 to-teal-600",
                  ];
                  return (
                    <div key={wallet.id} className="group relative overflow-hidden rounded-[22px] border border-slate-100 bg-white p-4 transition hover:-translate-y-1 hover:shadow-[0_20px_40px_-24px_rgba(127,0,255,0.5)]">
                      <div className="flex items-center justify-between">
                        <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${colors[index % colors.length]} text-base shadow-sm`}>
                          {CURRENCIES[wallet.currency]?.flag ?? "💳"}
                        </span>
                        {wallet.isPrimary && (
                          <span className="rounded-full bg-purple-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-[#7F00FF]">Main</span>
                        )}
                      </div>
                      <p className="mt-3 text-[11px] font-semibold text-slate-400">{wallet.name}</p>
                      <p className="mt-0.5 text-lg font-black tracking-tight">{formatMoney(wallet.balance, wallet.currency)}</p>
                      <div className="mt-3 flex items-center justify-between border-t border-slate-50 pt-3">
                        <span className="truncate text-[9px] font-medium text-slate-400">{wallet.accountNumber}</span>
                        <button
                          onClick={() => copyAccount(wallet.accountNumber)}
                          className="ml-2 text-slate-300 transition hover:text-[#7F00FF]"
                          aria-label="Copy account number"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Transactions and side widgets */}
          <section className="grid gap-5 xl:grid-cols-[1.6fr_0.9fr]">
            <div id="transactions" className="scroll-mt-28 overflow-hidden rounded-[26px] border border-slate-100 bg-white igw-shadow-soft">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-5">
                <div>
                  <h2 className="text-sm font-black tracking-tight">Recent activity</h2>
                  <p className="mt-1 text-[11px] text-slate-400">Activity across all your wallets</p>
                </div>
                <div className="flex rounded-xl bg-slate-100 p-1">
                  {(["all", "in", "out"] as const).map((item) => (
                    <button
                      key={item}
                      onClick={() => setFilter(item)}
                      className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition ${
                        filter === item ? "bg-white text-[#7F00FF] shadow-sm" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {item === "all" ? "All" : item === "in" ? "In" : "Out"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="max-h-[480px] overflow-y-auto scrollbar-thin">
                {visibleTransactions.length > 0 ? (
                  visibleTransactions.map((item) => <TransactionRow key={item.id} item={item} />)
                ) : (
                  <div className="px-5 py-14 text-center">
                    <Search className="mx-auto h-6 w-6 text-slate-300" />
                    <p className="mt-3 text-[13px] font-semibold text-slate-500">No matching transactions found.</p>
                  </div>
                )}
              </div>
              <div className="border-t border-slate-100 px-5 py-3.5 text-center">
                <span className="text-[11px] font-semibold text-slate-400">
                  {visibleTransactions.length} transactions shown
                </span>
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-[26px] border border-slate-100 bg-white p-5 igw-shadow-soft">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-black tracking-tight">Asset allocation</h2>
                    <p className="mt-1 text-[11px] text-slate-400">By currency wallet</p>
                  </div>
                  <Globe2 className="h-4 w-4 text-[#7F00FF]" />
                </div>
                <div className="mt-5 flex items-center gap-6">
                  <div
                    className="relative h-32 w-32 shrink-0 rounded-full"
                    style={{ background: `conic-gradient(${donutSegments.join(",")})` }}
                  >
                    <div className="absolute inset-[15px] flex flex-col items-center justify-center rounded-full bg-white">
                      <span className="text-[9px] font-semibold text-slate-400">Total</span>
                      <span className="text-sm font-black">{data.wallets.length} currencies</span>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    {data.wallets.map((wallet, index) => (
                      <div key={wallet.id} className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: ["#7F00FF", "#19A2D3", "#F59E0B", "#10B981"][index % 4] }}
                        />
                        <span className="text-[11px] font-bold text-slate-600">{wallet.currency}</span>
                        <span className="ml-auto text-[11px] font-bold text-slate-800">
                          %{Math.round(
                            (wallet.balance * (CURRENCIES[wallet.currency]?.usd ?? 1)) /
                              (data.stats.totalUsd || 1) *
                              100,
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div id="recipients" className="scroll-mt-28 rounded-[26px] border border-slate-100 bg-white p-5 igw-shadow-soft">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-black tracking-tight">Saved recipients</h2>
                    <p className="mt-1 text-[11px] text-slate-400">Send money in one tap</p>
                  </div>
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-50 text-[#7F00FF]"><Users className="h-4 w-4" /></span>
                </div>
                <div className="mt-4 space-y-1">
                  {data.recipients.map((recipient) => (
                    <div key={recipient.id} className="flex items-center gap-3 rounded-xl px-1 py-2 transition hover:bg-slate-50">
                      <span
                        className="flex h-9 w-9 items-center justify-center rounded-full text-[10px] font-black text-white"
                        style={{ background: recipient.color }}
                      >
                        {recipient.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-bold">{recipient.name}</p>
                        <p className="truncate text-[10px] text-slate-400">{recipient.currency} · {recipient.email}</p>
                      </div>
                      <button
                        onClick={() => {
                          openAction("send");
                          setForm((current) => ({ ...current, recipientId: recipient.id.toString() }));
                        }}
                        className="rounded-lg bg-slate-100 p-2 text-slate-500 transition hover:bg-purple-50 hover:text-[#7F00FF]"
                        aria-label={`${recipient.name} send money to`}
                      >
                        <Send className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div id="settings" className="scroll-mt-28 rounded-[26px] border border-slate-100 bg-white p-5 igw-shadow-soft">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-black tracking-tight">Preferences</h2>
                    <p className="mt-1 text-[11px] text-slate-400">Notification and security settings</p>
                  </div>
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                </div>
                <div className="mt-4 space-y-3">
                  {([
                    ["push", "Instant notifications", "Know about every transaction"],
                    ["email", "Email summary", "Your weekly account digest"],
                    ["security", "2FA protection", "Secure sign-in verification"],
                  ] as const).map(([key, label, description]) => (
                    <button
                      key={key}
                      onClick={() => setSwitches((current) => ({ ...current, [key]: !current[key] }))}
                      className="flex w-full items-center gap-3 rounded-xl px-1 py-1.5 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-bold">{label}</span>
                        <span className="block text-[10px] text-slate-400">{description}</span>
                      </span>
                      <span className={`relative h-5 w-9 rounded-full transition ${switches[key] ? "igw-gradient" : "bg-slate-200"}`}>
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${switches[key] ? "left-[18px]" : "left-0.5"}`} />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Cards */}
          <section id="cards" className="scroll-mt-28 rounded-[26px] border border-slate-100 bg-white p-6 igw-shadow-soft">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-black tracking-tight">My Cards</h2>
                <p className="mt-1 text-[11px] text-slate-400">Manage all your cards in one place and freeze them anytime</p>
              </div>
              <button
                onClick={() => setToast({ type: "ok", message: "Your new card request was received." })}
                className="inline-flex items-center gap-1.5 rounded-xl border border-purple-200 px-3.5 py-2 text-[11px] font-bold text-[#7F00FF] transition hover:bg-purple-50"
              >
                <Plus className="h-3.5 w-3.5" /> Create new card
              </button>
            </div>
            <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {data.cards.map((card) => (
                <BankCard key={card.id} card={card} onToggle={toggleCard} />
              ))}
            </div>
            <div className="mt-6 flex items-center gap-3 rounded-2xl bg-slate-50 p-4">
              <LockKeyhole className="h-5 w-5 shrink-0 text-[#7F00FF]" />
              <p className="text-[11px] leading-5 text-slate-500">
                All card activity is protected by 256-bit encryption. If you lose a card, freeze it with one tap.
              </p>
            </div>
          </section>

          <footer className="flex flex-wrap items-center justify-between gap-3 pb-4 text-[11px] text-slate-400">
            <p>© {new Date().getFullYear()} Insta Global Wallet · Demo dashboard</p>
            <p className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Secure connection · {data.user.plan}</p>
          </footer>
        </main>
      </div>

      {/* Action drawer */}
      {action && (
        <div className="fixed inset-0 z-[60] flex">
          <button className="absolute inset-0 bg-[#10152b]/55 backdrop-blur-sm" onClick={() => setAction(null)} aria-label="Kapat" />
          <div className="relative ml-auto flex h-full w-full max-w-[440px] flex-col bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7F00FF]">New transaction</p>
                <h2 className="mt-1.5 text-xl font-black tracking-tight">{actionTitles[action].title}</h2>
                <p className="mt-1 text-[12px] text-slate-500">{actionTitles[action].subtitle}</p>
              </div>
              <button onClick={() => setAction(null)} className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Kapat">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={submitAction} className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6 scrollbar-thin">
                {action === "send" && (
                  <>
                    <div>
                      <label className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Recipient</label>
                      <select
                        value={form.recipientId}
                        onChange={(event) => setForm((current) => ({ ...current, recipientId: event.target.value }))}
                        className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-800 focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                      >
                        {data.recipients.map((recipient) => (
                          <option key={recipient.id} value={recipient.id}>{recipient.name} · {recipient.currency}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-slate-500">From wallet</label>
                      <select
                        value={form.walletId}
                        onChange={(event) => setForm((current) => ({ ...current, walletId: event.target.value }))}
                        className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-800 focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                      >
                        {data.wallets.map((wallet) => (
                          <option key={wallet.id} value={wallet.id}>
                            {CURRENCIES[wallet.currency]?.flag} {wallet.currency} · {formatMoney(wallet.balance, wallet.currency)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                {(action === "topup" || action === "withdraw" || action === "exchange") && (
                  <div>
                    <label className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      {action === "exchange" ? "From wallet" : "Wallet"}
                    </label>
                    <select
                      value={form.walletId}
                      onChange={(event) => setForm((current) => ({ ...current, walletId: event.target.value }))}
                      className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-800 focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                    >
                      {data.wallets.map((wallet) => (
                        <option key={wallet.id} value={wallet.id}>
                          {CURRENCIES[wallet.currency]?.flag} {wallet.currency} · {formatMoney(wallet.balance, wallet.currency)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {action === "exchange" && (
                  <div>
                    <label className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-slate-500">To wallet</label>
                    <select
                      value={form.targetWalletId}
                      onChange={(event) => setForm((current) => ({ ...current, targetWalletId: event.target.value }))}
                      className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-800 focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                    >
                      {data.wallets.map((wallet) => (
                        <option key={wallet.id} value={wallet.id}>
                          {CURRENCIES[wallet.currency]?.flag} {wallet.currency} · {formatMoney(wallet.balance, wallet.currency)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {(action === "topup" || action === "withdraw") && (
                  <div>
                    <label className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      {action === "topup" ? "Payment method" : "Withdrawal account"}
                    </label>
                    <select
                      value={form.method}
                      onChange={(event) => setForm((current) => ({ ...current, method: event.target.value }))}
                      className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-800 focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                    >
                      <option>Bank card •••• 3910</option>
                      <option>Bank account •••• 7742</option>
                      <option>IGW Virtual •••• 4291</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Amount</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">
                      {selectedWallet ? CURRENCIES[selectedWallet.currency]?.symbol : "$"}
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      autoFocus
                      value={form.amount}
                      onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                      placeholder="0,00"
                      className="h-14 w-full rounded-xl border border-slate-200 pl-10 pr-20 text-xl font-black text-[#10152b] focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400">
                      {selectedWallet?.currency ?? "USD"}
                    </span>
                  </div>
                  {selectedWallet && (
                    <p className="mt-2 text-[11px] text-slate-400">
                      Available balance: <span className="font-bold text-slate-600">{formatMoney(selectedWallet.balance, selectedWallet.currency)}</span>
                    </p>
                  )}
                </div>

                {preview !== null && (
                  <div className="flex items-center gap-3 rounded-2xl igw-gradient-soft p-4">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#7F00FF] shadow-sm"><Repeat2 className="h-4 w-4" /></span>
                    <div>
                      <p className="text-[10px] font-semibold text-slate-500">Recipient will receive</p>
                      <p className="text-sm font-black text-[#10152b]">
                        {formatMoney(preview, action === "send" ? selectedRecipient?.currency ?? "USD" : targetWallet?.currency ?? "USD")}
                      </p>
                    </div>
                  </div>
                )}

                <div>
                  <label className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Note <span className="font-normal normal-case text-slate-400">(optional)</span></label>
                  <textarea
                    value={form.note}
                    onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                    rows={3}
                    placeholder="Add a note for this transaction..."
                    className="w-full resize-none rounded-xl border border-slate-200 p-3 text-[13px] font-medium text-slate-800 focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                  />
                </div>

                <div className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-3.5">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <p className="text-[11px] leading-5 text-slate-500">Your transaction is protected with 256-bit encryption and updates instantly.</p>
                </div>
              </div>

              <div className="border-t border-slate-100 bg-white px-6 py-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="igw-gradient flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[13px] font-bold text-white shadow-[0_14px_28px_-12px_rgba(127,0,255,0.9)] transition hover:-translate-y-0.5 disabled:opacity-60"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {loading ? "Processing..." : "Confirm transaction"}
                </button>
                <button type="button" onClick={() => setAction(null)} className="mt-2 h-10 w-full rounded-xl text-[12px] font-semibold text-slate-400 transition hover:text-slate-700">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[80] flex max-w-sm items-center gap-3 rounded-2xl px-4 py-3.5 text-[12px] font-bold text-white shadow-2xl ${
          toast.type === "ok" ? "bg-[#10152b]" : "bg-rose-600"
        }`}>
          {toast.type === "ok" ? <Check className="h-4 w-4 text-emerald-300" /> : <X className="h-4 w-4" />}
          {toast.message}
        </div>
      )}
    </div>
  );
}
