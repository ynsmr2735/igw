"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Bell,
  Coins,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  Globe2,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Send,
  ShieldCheck,
  User,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { Brand } from "@/components/Brand";
import { signOutAction } from "@/app/auth/actions";
import {
  DEPOSIT_STATUS_LABEL,
  TX_STATUS_LABEL,
  TX_TYPE_LABEL,
  formatAccountNumber,
  formatDate,
  formatMoney,
} from "@/lib/format";
import { METHOD_INFO, type PaymentMethod } from "@/lib/payment-methods";
import type { DashboardData, Deposit, TransferResult, Transaction } from "@/lib/wallet";
import {
  Badge,
  Card,
  CopyButton,
  QrCode,
  STATUS_TONE,
  SectionTitle,
  ToastView,
  postJson,
  type Toast,
} from "@/components/wallet-ui";

const navItems: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "deposit", label: "Deposit", icon: Download },
  { id: "transfer", label: "Transfer", icon: Send },
  { id: "transactions", label: "Transactions", icon: ArrowLeftRight },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "profile", label: "Profile", icon: User },
];

const inputClass =
  "h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base font-semibold text-slate-800 transition focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100 sm:text-[13px]";
const primaryButton =
  "igw-gradient inline-flex h-12 items-center justify-center gap-2 rounded-xl px-5 text-[13px] font-bold text-white shadow-[0_14px_30px_-12px_rgba(127,0,255,0.9)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";
const secondaryButton =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-[13px] font-bold text-slate-700 transition hover:border-purple-300 hover:text-[#7F00FF] disabled:opacity-50";

function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16),
      );
}

/* ---------------------------------------------------------------------------------------------- */

function TransactionItem({ tx }: { tx: Transaction }) {
  const incoming = tx.direction === "in";
  return (
    <li className="flex items-start gap-3 border-b border-slate-50 px-1 py-3.5 last:border-0">
      <span
        className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
          incoming ? "bg-emerald-50 text-emerald-600" : "bg-purple-50 text-[#7F00FF]"
        }`}
      >
        {incoming ? <ArrowDownLeft className="h-[18px] w-[18px]" /> : <ArrowUpRight className="h-[18px] w-[18px]" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-[13px] font-bold">{TX_TYPE_LABEL[tx.type] ?? tx.type}</p>
          <Badge tone={STATUS_TONE[tx.status]}>{TX_STATUS_LABEL[tx.status] ?? tx.status}</Badge>
        </div>
        <p className="mt-1 break-words text-[12px] text-slate-500">{tx.description || tx.counterparty}</p>
        <p className="mt-1 text-[11px] text-slate-400">
          <span className="font-mono">{tx.reference}</span> · {formatDate(tx.createdAt)}
        </p>
      </div>
      <p
        className={`shrink-0 text-right text-[13px] font-black ${
          tx.status === "failed" || tx.status === "cancelled"
            ? "text-slate-400 line-through"
            : incoming
              ? "text-emerald-600"
              : "text-[#10152b]"
        }`}
      >
        {incoming ? "+" : "−"}
        {formatMoney(tx.amount, tx.currency)}
      </p>
    </li>
  );
}

/* ---------------------------------------------------------------------------------------------- */

function MethodWarning({ method, amountCrypto }: { method: PaymentMethod; amountCrypto: string }) {
  if (method === "usdt_trc20") {
    return (
      <div className="space-y-3">
        <div role="note" className="flex gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 text-[12px] leading-5 text-rose-900" data-testid="trc20-warning">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
          <div>
            <p className="text-[13px] font-black">Send only USDT on the TRON (TRC20) network</p>
            <p className="mt-1">
              This address accepts only <b>USDT TRC20</b>. Sending USDT on another network (ERC20 / Ethereum, BEP20 / BSC,
              Polygon, Solana…), or sending any other coin or token (TRX, USDC…), will be <b>lost permanently</b> and cannot be
              credited or refunded.
            </p>
          </div>
        </div>
        <ul className="space-y-1.5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[12px] leading-5 text-amber-900">
          <li>• Send <b>exactly {amountCrypto} USDT</b>. The cents are a unique identifier of your request. If your exchange deducts a withdrawal fee, add it so that exactly this amount arrives.</li>
          <li>• In your wallet or exchange choose the network <b>TRON (TRC20)</b>.</li>
          <li>• Your balance is credited after an admin has checked and approved your payment.</li>
        </ul>
      </div>
    );
  }
  return (
    <ul className="space-y-1.5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[12px] leading-5 text-amber-900">
      <li>• Send <b>exactly {amountCrypto} BTC</b>. Pay the network fee on top; if your exchange deducts a withdrawal fee from the amount, add it so that exactly this amount arrives.</li>
      <li>• Use the <b>Bitcoin network (Mainnet)</b> only. Payments on other networks (Lightning, BEP20, testnet…) cannot be recovered.</li>
      <li>• Your balance is credited after an admin has checked and approved your payment.</li>
    </ul>
  );
}

function DepositSection({
  data,
  onChanged,
  notify,
}: {
  data: DashboardData;
  onChanged: () => Promise<void>;
  notify: (toast: Toast) => void;
}) {
  const config = data.depositConfig;
  const open = data.openDeposit;
  const firstAvailable = config.methods.find((m) => m.enabled && m.address)?.method ?? "btc";
  const [chosen, setChosen] = useState<PaymentMethod>(firstAvailable);
  const [amount, setAmount] = useState("");
  const [txid, setTxid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const method: PaymentMethod = open?.method ?? chosen;
  const info = METHOD_INFO[method];
  const methodConfig = config.methods.find((m) => m.method === method);

  async function run(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/deposits", body);
      await onChanged();
      notify({ type: "ok", message: success });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createQuote(event: FormEvent) {
    event.preventDefault();
    if (
      await run(
        { action: "create", method: chosen, amountUsd: amount.trim() },
        `Payment details created. Send the exact ${info.asset} amount.`,
      )
    ) {
      setAmount("");
    }
  }

  async function submitPayment(event: FormEvent) {
    event.preventDefault();
    if (
      open &&
      (await run(
        { action: "submit", requestId: open.id, txid: txid.trim() },
        "Your payment request has been received. Awaiting admin review.",
      ))
    ) {
      setTxid("");
    }
  }

  const paymentUri = open ? info.qrPayload(open.depositAddress, open.amountCrypto) : "";

  return (
    <Card id="deposit">
      <SectionTitle
        eyebrow="Add money"
        title="Deposit with crypto"
        action={
          <Badge tone={method === "usdt_trc20" ? "red" : "amber"}>
            <Coins className="mr-1 h-3 w-3" /> Network: {info.networkLabel}
          </Badge>
        }
      />

      {!open && (
        <div role="radiogroup" aria-label="Payment method" className="mb-5 grid gap-3 sm:grid-cols-2">
          {config.methods.map((m) => {
            const selected = m.method === chosen;
            const available = Boolean(m.address) && m.enabled;
            return (
              <div
                key={m.method}
                className={`overflow-hidden rounded-2xl border-2 transition ${
                  selected ? "border-[#7F00FF] bg-purple-50/60" : "border-slate-200 bg-white hover:border-purple-200"
                }`}
              >
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`method-${m.method}`}
                onClick={() => {
                  setChosen(m.method);
                  setError(null);
                }}
                className="flex w-full items-center gap-3 p-4 text-left"
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-[12px] font-black ${
                    m.method === "usdt_trc20" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {m.method === "usdt_trc20" ? "₮" : "₿"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-black">{METHOD_INFO[m.method].name}</span>
                  <span className="block text-[11px] text-slate-500">Network: {m.networkLabel}</span>
                </span>
                {!available && <Badge tone="slate">{m.address ? "Disabled" : "Unavailable"}</Badge>}
              </button>
              {/* The admin's current address for this method, always visible (set in Admin -> Payment methods). */}
              <div className="border-t border-slate-100 px-4 pb-3 pt-2.5" data-testid={`address-${m.method}`}>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  {m.method === "usdt_trc20" ? "USDT TRC20 address (TRON network only)" : "BTC address (Bitcoin network)"}
                </p>
                {m.address ? (
                  <div className="mt-1 flex items-center gap-2">
                    <code className="min-w-0 flex-1 break-all text-[12px] font-bold text-slate-700">{m.address}</code>
                    <CopyButton
                      value={m.address}
                      label="Copy"
                      onCopied={(ok) => notify(ok ? { type: "ok", message: `${METHOD_INFO[m.method].short} address copied. Enter the amount below to get the exact amount to send.` } : { type: "error", message: "Could not copy." })}
                    />
                  </div>
                ) : (
                  <p className="mt-1 text-[12px] text-slate-500">Not available yet</p>
                )}
              </div>
              </div>
            );
          })}
        </div>
      )}

      {!open && config.methods.length === 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800">
          Deposits are temporarily unavailable. Please try again later.
        </div>
      )}

      {!open && config.methods.length > 0 && !methodConfig?.address && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800" data-testid="method-unavailable">
          {info.name} deposits are not available yet: the administrator has not configured a deposit address.
        </div>
      )}

      {!open && methodConfig?.address && !methodConfig.enabled && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800" data-testid="deposits-disabled">
          {info.name} deposits are temporarily disabled. Please try again later.
        </div>
      )}

      {!open && methodConfig?.address && methodConfig.enabled && (
        <form onSubmit={createQuote} className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <label htmlFor="deposit-amount" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Amount to deposit (USD)
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[13px] font-bold text-slate-400">$</span>
              <input
                id="deposit-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder={`${config.minUsd} – ${config.maxUsd}`}
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(",", "."))}
                className={`${inputClass} pl-8`}
                required
              />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Min {formatMoney(config.minUsd)} · max {formatMoney(config.maxUsd)}.{" "}
              {method === "usdt_trc20"
                ? "1 USDT = 1 USD. A unique amount of cents (0.01–0.99) is added to identify your payment and is credited too."
                : `The BTC amount is calculated from the live BTC/USD price. Please pay within ${config.quoteMinutes} minutes so the price still matches.`}
            </p>
          </div>
          <button type="submit" disabled={busy || !amount} className={primaryButton}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
            Get payment details
          </button>
        </form>
      )}

      {open?.status === "awaiting_payment" && (
        <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-3xl border border-slate-100 p-3 shadow-sm">
              <QrCode value={paymentUri} label={`${info.name} payment QR code`} />
            </div>
            <p className="text-center text-[11px] text-slate-500">
              {method === "usdt_trc20" ? "Scan the address with a TRON (TRC20) wallet" : "Scan with your Bitcoin wallet"}
            </p>
          </div>

          <div className="min-w-0 space-y-4">
            <div className="rounded-2xl bg-[#10152b] p-4 text-white">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/50">Send exactly</p>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <p className="break-all font-mono text-xl font-black sm:text-2xl" data-testid="crypto-amount">
                  {open.amountCrypto} {info.asset}
                </p>
                <CopyButton value={open.amountCrypto} label="Copy amount" dark onCopied={(ok) => notify(ok ? { type: "ok", message: "Amount copied." } : { type: "error", message: "Could not copy." })} />
              </div>
              <p className="mt-1 text-[12px] text-white/60">
                {method === "usdt_trc20"
                  ? <>= {formatMoney(open.amountUsd)} credited · Tether USDT on TRON (TRC20)</>
                  : <>= {formatMoney(open.amountUsd)} at {formatMoney(open.usdRate)} / BTC ({open.amountUnits.toLocaleString("en-US")} sats)</>}
              </p>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                To this {method === "usdt_trc20" ? "USDT TRC20 (TRON network)" : "Bitcoin (Mainnet)"} address
              </p>
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <code className="min-w-0 flex-1 break-all text-[13px] font-bold text-slate-800" data-testid="deposit-address">
                  {open.depositAddress}
                </code>
                <CopyButton value={open.depositAddress} label="Copy address" onCopied={(ok) => notify(ok ? { type: "ok", message: "Address copied." } : { type: "error", message: "Could not copy." })} />
              </div>
            </div>

            <MethodWarning method={method} amountCrypto={open.amountCrypto} />
            <p className="text-[12px] text-slate-600">
              Reference: <span className="font-mono">{open.reference}</span> · created {formatDate(open.createdAt)}. After paying, enter the
              transaction ID and press <b>I&apos;ve paid</b>. The request stays open until then (or until you cancel it).
            </p>

            <form onSubmit={submitPayment} className="space-y-3">
              <div>
                <label htmlFor="txid" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Transaction ID (TXID / hash) of your payment
                </label>
                <input
                  id="txid"
                  value={txid}
                  onChange={(event) => setTxid(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="64 characters, shown by your wallet after sending"
                  className={`${inputClass} font-mono`}
                  required
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="submit" disabled={busy || txid.trim().length === 0} className={primaryButton}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  I&apos;ve paid
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run({ action: "cancel", requestId: open.id }, "Deposit request cancelled.")}
                  className={secondaryButton}
                >
                  Cancel request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {open?.status === "reviewing" && (
        <div className="rounded-2xl border border-purple-200 bg-purple-50/70 p-5" data-testid="deposit-review">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-[#7F00FF]">
              <Clock className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-black">Your payment request has been received. Awaiting admin review.</p>
              <p className="mt-1 text-[12px] leading-5 text-slate-600">
                An admin checks your payment and decides manually. Your balance changes only after the admin approves it;
                you will get a notification either way.
              </p>
              <p className="mt-2"><Badge tone="purple">Status: Pending review</Badge></p>
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
                <div><dt className="inline text-slate-500">Reference: </dt><dd className="inline font-mono font-bold">{open.reference}</dd></div>
                <div><dt className="inline text-slate-500">Method: </dt><dd className="inline font-bold">{info.name}</dd></div>
                <div><dt className="inline text-slate-500">Amount: </dt><dd className="inline font-bold">{formatMoney(open.amountUsd)} · {open.amountCrypto} {info.asset}</dd></div>
                <div><dt className="inline text-slate-500">Network: </dt><dd className="inline font-bold">{info.networkLabel}</dd></div>
                <div className="sm:col-span-2"><dt className="inline text-slate-500">TXID: </dt><dd className="inline break-all font-mono">{open.txid}</dd></div>
              </dl>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-[12px] font-semibold text-rose-600">
          {error}
        </p>
      )}

      {data.deposits.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Payment history</p>
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100" data-testid="payment-history">
            {data.deposits.map((deposit: Deposit) => (
              <li key={deposit.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[12px]">
                <span className="font-mono text-slate-500">{deposit.reference}</span>
                <Badge tone={deposit.method === "usdt_trc20" ? "green" : "amber"}>{METHOD_INFO[deposit.method].short}</Badge>
                <span className="font-bold">{formatMoney(deposit.amountUsd)}</span>
                <span className="text-slate-500">{deposit.amountCrypto} {deposit.asset}</span>
                <span className="text-slate-400">{formatDate(deposit.createdAt)}</span>
                {deposit.txid && <span className="font-mono text-slate-400">TXID {deposit.txid.slice(0, 10)}…</span>}
                <span className="ml-auto"><Badge tone={STATUS_TONE[deposit.status]}>{DEPOSIT_STATUS_LABEL[deposit.status]}</Badge></span>
                {deposit.rejectionReason && <p className="w-full text-rose-600">Reason: {deposit.rejectionReason}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------------------------------------- */

type TransferStep =
  | { step: "form" }
  | { step: "confirm"; recipient: { accountNumber: string; name: string }; amount: string; note: string; requestId: string }
  | { step: "done"; result: TransferResult };

function TransferSection({
  data,
  onChanged,
  notify,
}: {
  data: DashboardData;
  onChanged: () => Promise<void>;
  notify: (toast: Toast) => void;
}) {
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<TransferStep>({ step: "form" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanAccount = account.replace(/\D/g, "");
  const amountNumber = Number(amount);
  const amountValid = /^\d+(\.\d{1,2})?$/.test(amount) && amountNumber > 0;
  const enough = amountValid && amountNumber <= data.wallet.balance;

  async function checkRecipient(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (cleanAccount.length !== 8) return setError("Account numbers have exactly 8 digits.");
    if (cleanAccount === data.user.accountNumber) return setError("You cannot transfer money to your own account.");
    if (!amountValid) return setError("Enter an amount greater than zero (max. 2 decimals).");
    if (!enough) return setError("Insufficient balance.");
    setBusy(true);
    try {
      const response = await postJson<{ recipient: { accountNumber: string; name: string } }>("/api/transfers", {
        action: "lookup",
        accountNumber: cleanAccount,
      });
      // One id per confirmation screen: a double click or retry can never send twice.
      setState({ step: "confirm", recipient: response.recipient, amount, note, requestId: newRequestId() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recipient could not be checked.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (state.step !== "confirm") return;
    setBusy(true);
    setError(null);
    try {
      const response = await postJson<{ transfer: TransferResult }>("/api/transfers", {
        action: "send",
        accountNumber: state.recipient.accountNumber,
        amount: state.amount,
        idempotencyKey: state.requestId,
        note: state.note,
      });
      setState({ step: "done", result: response.transfer });
      setAccount("");
      setAmount("");
      setNote("");
      await onChanged();
      notify({ type: "ok", message: "Transfer completed." });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="transfer">
      <SectionTitle eyebrow="Send money" title="Transfer to another member" />

      {state.step === "form" && (
        <form onSubmit={checkRecipient} className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="recipient-account" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Recipient account number
            </label>
            <input
              id="recipient-account"
              inputMode="numeric"
              autoComplete="off"
              maxLength={9}
              placeholder="8 digits"
              value={account}
              onChange={(event) => setAccount(event.target.value.replace(/[^\d ]/g, ""))}
              className={`${inputClass} font-mono tracking-[0.2em]`}
              required
            />
          </div>
          <div>
            <label htmlFor="transfer-amount" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Amount (USD)
            </label>
            <input
              id="transfer-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(",", ".").replace(/[^\d.]/g, ""))}
              className={inputClass}
              required
            />
            <p className="mt-1.5 text-[11px] text-slate-500">Available: {formatMoney(data.wallet.balance)}</p>
          </div>
          <div className="md:col-span-2">
            <label htmlFor="transfer-note" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Description (optional)
            </label>
            <input
              id="transfer-note"
              maxLength={140}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className={inputClass}
            />
          </div>
          <div className="md:col-span-2">
            <button type="submit" disabled={busy} className={`${primaryButton} w-full sm:w-auto`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Check recipient
            </button>
          </div>
        </form>
      )}

      {state.step === "confirm" && (
        <div className="space-y-4" data-testid="transfer-confirm">
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Please confirm</p>
            <dl className="mt-3 grid gap-3 text-[13px] sm:grid-cols-3">
              <div>
                <dt className="text-[11px] text-slate-500">Recipient</dt>
                <dd className="font-black" data-testid="recipient-name">{state.recipient.name}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500">Account number</dt>
                <dd className="font-mono font-bold">{formatAccountNumber(state.recipient.accountNumber)}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-slate-500">Amount</dt>
                <dd className="text-lg font-black text-[#7F00FF]">{formatMoney(Number(state.amount))}</dd>
              </div>
            </dl>
            {state.note && <p className="mt-3 text-[12px] text-slate-600">“{state.note}”</p>}
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={confirm} disabled={busy} className={primaryButton}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Confirm transfer
            </button>
            <button type="button" disabled={busy} onClick={() => { setState({ step: "form" }); setError(null); }} className={secondaryButton}>
              Back
            </button>
          </div>
        </div>
      )}

      {state.step === "done" && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5" data-testid="transfer-done">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
            <div className="min-w-0 text-[13px]">
              <p className="font-black text-emerald-800">
                {formatMoney(state.result.amount)} sent to {state.result.recipientName}
              </p>
              <p className="mt-1 text-emerald-900/80">
                Account {formatAccountNumber(state.result.recipientAccount)} · Reference{" "}
                <span className="font-mono font-bold">{state.result.reference}</span>
              </p>
              <p className="mt-1 text-emerald-900/80">New balance: {formatMoney(state.result.balance)}</p>
            </div>
          </div>
          <button type="button" onClick={() => setState({ step: "form" })} className={`${secondaryButton} mt-4`}>
            New transfer
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-[12px] font-semibold text-rose-600">
          {error}
        </p>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------------------------------------- */

export default function DashboardClient({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState(initialData);
  const [activeNav, setActiveNav] = useState("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [filter, setFilter] = useState<"all" | "in" | "out">("all");

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    if (response.status === 401) {
      window.location.assign("/login?next=/dashboard");
      return;
    }
    if (response.ok) setData((await response.json()) as DashboardData);
  }, []);

  // Balance, notifications and deposit status stay current without a reload.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh().catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, [refresh]);

  function goTo(id: string) {
    setActiveNav(id);
    setMobileOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function markAllRead() {
    try {
      await postJson("/api/notifications", { action: "read" });
      await refresh();
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Could not update notifications." });
    }
  }

  const transactions = data.transactions.filter((tx) => filter === "all" || tx.direction === filter);
  const copied = (ok: boolean) =>
    setToast(ok ? { type: "ok", message: "Account number copied." } : { type: "error", message: "Could not copy." });

  return (
    <div lang="en" className="min-h-screen bg-[#f7f7fb] text-[#10152b]">
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

        <nav className="flex-1 space-y-1.5 overflow-y-auto px-4 py-6">
          <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/30">Menu</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => goTo(item.id)}
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-semibold transition ${
                  active ? "igw-gradient text-white shadow-[0_10px_24px_-10px_rgba(127,0,255,0.9)]" : "text-white/55 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" />
                {item.label}
                {item.id === "notifications" && data.unreadCount > 0 && (
                  <span className="ml-auto rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-black text-white">{data.unreadCount}</span>
                )}
                {active && item.id !== "notifications" && <ChevronRight className="ml-auto h-4 w-4 opacity-70" />}
              </button>
            );
          })}

          <p className="mb-3 mt-8 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/30">Quick access</p>
          {data.user.isAdmin && (
            <Link href="/admin" className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-semibold text-amber-300 transition hover:bg-white/5">
              <ShieldCheck className="h-[18px] w-[18px]" /> Admin panel
            </Link>
          )}
          <Link href="/" className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-semibold text-white/55 transition hover:bg-white/5 hover:text-white">
            <Globe2 className="h-[18px] w-[18px]" /> Home page
          </Link>
        </nav>

        <div className="p-4">
          <div className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-[12px] font-semibold text-white/60">
            <span className="flex h-9 w-9 items-center justify-center rounded-full igw-gradient text-[11px] font-black text-white">{data.user.initials}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-white">{data.user.name}</span>
              <span className="block truncate text-[10px] font-normal text-white/40">{data.user.email}</span>
            </span>
          </div>
          <form action={signOutAction}>
            <button type="submit" className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[12px] font-semibold text-white/50 transition hover:bg-white/5 hover:text-white">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </form>
        </div>
      </aside>

      {mobileOpen && (
        <button className="fixed inset-0 z-40 bg-[#10152b]/60 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu" />
      )}

      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur-xl">
          <div className="flex h-[68px] items-center gap-3 px-4 sm:h-[76px] sm:px-8">
            <button className="text-slate-600 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="hidden text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 sm:block">Insta Global Wallet</p>
              <p className="truncate text-sm font-extrabold">{navItems.find((item) => item.id === activeNav)?.label ?? "Overview"}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => goTo("notifications")}
                className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:text-[#7F00FF]"
                aria-label={`Notifications (${data.unreadCount} unread)`}
              >
                <Bell className="h-[18px] w-[18px]" />
                {data.unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">
                    {data.unreadCount}
                  </span>
                )}
              </button>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl igw-gradient text-[11px] font-black text-white">{data.user.initials}</span>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1280px] space-y-6 px-4 py-6 sm:px-8 sm:py-8">
          <div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Hello, {data.user.name.split(" ")[0]} 👋</h1>
            <p className="mt-1 text-[13px] text-slate-500">Your balance, deposits and transfers in one place.</p>
          </div>

          {/* Overview */}
          <section id="overview" className="grid scroll-mt-28 gap-5 lg:grid-cols-[1.6fr_1fr]">
            <div className="relative overflow-hidden rounded-[26px] igw-gradient p-6 text-white igw-shadow sm:p-7">
              <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-white/15 blur-2xl" />
              <div className="relative flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">Total balance</p>
                  <p className="mt-2 break-all text-[clamp(2rem,6vw,2.9rem)] font-black tracking-tight" data-testid="balance">
                    {formatMoney(data.wallet.balance)}
                  </p>
                </div>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
                  <Wallet className="h-5 w-5" />
                </span>
              </div>
              <div className="relative mt-6 flex flex-wrap items-center gap-3 rounded-2xl bg-white/10 p-3 backdrop-blur">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/60">Account number</p>
                  <p className="font-mono text-xl font-black tracking-[0.18em]" data-testid="account-number">
                    {formatAccountNumber(data.user.accountNumber)}
                  </p>
                </div>
                <CopyButton value={data.user.accountNumber} label="Copy" dark className="ml-auto" onCopied={copied} />
              </div>
              <div className="relative mt-5 flex flex-wrap gap-2.5">
                <button onClick={() => goTo("deposit")} className="rounded-xl bg-white px-4 py-2.5 text-[12px] font-bold text-[#7F00FF] transition hover:-translate-y-0.5">
                  + Deposit
                </button>
                <button onClick={() => goTo("transfer")} className="rounded-xl bg-white/15 px-4 py-2.5 text-[12px] font-bold text-white backdrop-blur transition hover:bg-white/25">
                  Transfer
                </button>
                <button disabled title="Withdrawals are coming soon" className="cursor-not-allowed rounded-xl bg-white/10 px-4 py-2.5 text-[12px] font-bold text-white/50">
                  Withdraw · soon
                </button>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-[26px] border border-slate-100 bg-white p-5 igw-shadow-soft">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600"><ArrowDownLeft className="h-5 w-5" /></span>
                <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Money in · last 30 days</p>
                <p className="mt-1 text-2xl font-black tracking-tight">{formatMoney(data.stats.moneyIn)}</p>
              </div>
              <div className="rounded-[26px] border border-slate-100 bg-white p-5 igw-shadow-soft">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-purple-50 text-[#7F00FF]"><ArrowUpRight className="h-5 w-5" /></span>
                <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Money out · last 30 days</p>
                <p className="mt-1 text-2xl font-black tracking-tight">{formatMoney(data.stats.moneyOut)}</p>
              </div>
            </div>
          </section>

          <DepositSection data={data} onChanged={refresh} notify={setToast} />
          <TransferSection data={data} onChanged={refresh} notify={setToast} />

          <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            <Card id="transactions">
              <SectionTitle
                eyebrow="History"
                title="Transactions"
                action={
                  <div className="flex rounded-xl bg-slate-100 p-1 text-[11px] font-bold">
                    {(["all", "in", "out"] as const).map((key) => (
                      <button
                        key={key}
                        onClick={() => setFilter(key)}
                        className={`rounded-lg px-3 py-1.5 transition ${filter === key ? "bg-white text-[#7F00FF] shadow-sm" : "text-slate-500"}`}
                      >
                        {key === "all" ? "All" : key === "in" ? "Incoming" : "Outgoing"}
                      </button>
                    ))}
                  </div>
                }
              />
              {transactions.length === 0 ? (
                <p className="rounded-2xl bg-slate-50 p-6 text-center text-[13px] text-slate-500">No transactions yet.</p>
              ) : (
                <ul>{transactions.map((tx) => <TransactionItem key={tx.id} tx={tx} />)}</ul>
              )}
            </Card>

            <Card id="notifications">
              <SectionTitle
                eyebrow="Updates"
                title="Notifications"
                action={
                  data.unreadCount > 0 ? (
                    <button onClick={markAllRead} className="text-[11px] font-bold text-[#7F00FF] hover:underline">
                      Mark all as read
                    </button>
                  ) : undefined
                }
              />
              {data.notifications.length === 0 ? (
                <p className="rounded-2xl bg-slate-50 p-6 text-center text-[13px] text-slate-500">No notifications yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {data.notifications.map((n) => (
                    <li
                      key={n.id}
                      className={`rounded-2xl border p-3.5 text-[12px] ${n.read ? "border-slate-100 bg-white" : "border-purple-200 bg-purple-50/60"}`}
                    >
                      <div className="flex items-center gap-2">
                        {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-[#7F00FF]" aria-label="Unread" />}
                        <p className="font-black">{n.title}</p>
                        <span className="ml-auto shrink-0 text-[10px] text-slate-400">{formatDate(n.createdAt)}</span>
                      </div>
                      <p className="mt-1 leading-5 text-slate-600">{n.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card id="profile">
            <SectionTitle eyebrow="Account" title="Profile" />
            <dl className="grid gap-4 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-[11px] text-slate-500">Name</dt><dd className="mt-1 font-bold">{data.user.name}</dd></div>
              <div><dt className="text-[11px] text-slate-500">Email</dt><dd className="mt-1 break-all font-bold">{data.user.email}</dd></div>
              <div>
                <dt className="text-[11px] text-slate-500">Account number</dt>
                <dd className="mt-1 flex items-center gap-2">
                  <span className="font-mono font-black tracking-[0.12em]">{formatAccountNumber(data.user.accountNumber)}</span>
                  <CopyButton value={data.user.accountNumber} onCopied={copied} />
                </dd>
              </div>
              <div><dt className="text-[11px] text-slate-500">Member since</dt><dd className="mt-1 font-bold">{formatDate(data.user.memberSince)}</dd></div>
            </dl>
          </Card>
        </main>
      </div>

      <ToastView toast={toast} />
    </div>
  );
}
