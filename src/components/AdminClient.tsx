"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Bell,
  CheckCircle2,
  Clock,
  ChevronRight,
  ExternalLink,
  History,
  Inbox,
  Loader2,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Wallet,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Brand } from "@/components/Brand";
import { signOutAction } from "@/app/auth/actions";
import type { AdminDeposit, AdminDepositDetail, AdminOverview, AdminPoll, AdminTransaction, AuditEntry } from "@/lib/admin";
import {
  isBlocked,
  loadLastSeen,
  loadSoundSettings,
  playChime,
  saveLastSeen,
  saveSoundSettings,
  unlockAudio,
  type SoundSettings,
} from "@/lib/admin-sound";
import type { StatusItem } from "@/lib/system";
import { METHOD_INFO, methodInfo, type DepositVerification, type MethodConfig, type PaymentMethod } from "@/lib/payment-methods";
import {
  DEPOSIT_STATUS_LABEL,
  TX_STATUS_LABEL,
  TX_TYPE_LABEL,
  formatAccountNumber,
  formatDate,
  formatMoney,
  shortHash,
} from "@/lib/format";
import { Badge, Card, CopyButton, STATUS_TONE, SectionTitle, ToastView, postJson, type Toast } from "@/components/wallet-ui";

type View = "notifications" | "deposits" | "transactions" | "settings" | "audit";

const navItems: { id: View; label: string; icon: LucideIcon }[] = [
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "deposits", label: "Payment requests", icon: Inbox },
  { id: "transactions", label: "Transactions", icon: ArrowLeftRight },
  { id: "settings", label: "Payment methods", icon: Settings },
  { id: "audit", label: "Audit log", icon: History },
];

const FILTERS: { id: string | null; label: string }[] = [
  { id: null, label: "All payments" },
  { id: "reviewing", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "awaiting_payment", label: "Not paid yet" },
];

const METHOD_FILTERS: { id: PaymentMethod | null; label: string }[] = [
  { id: null, label: "All methods" },
  { id: "btc", label: "BTC" },
  { id: "usdt_trc20", label: "USDT TRC20" },
];

const methodName = (method: unknown) => (method ? methodInfo(String(method)).short : "BTC");

const AUDIT_LABEL: Record<string, string> = {
  deposit_address_changed: "Deposit address changed",
  deposits_enabled: "Payment method enabled",
  deposits_disabled: "Payment method disabled",
  btc_address_changed: "BTC address changed",
  btc_deposits_enabled: "BTC payments enabled",
  btc_deposits_disabled: "BTC payments disabled",
  deposit_approved: "Payment approved",
  deposit_rejected: "Payment rejected",
};

function auditSummary(entry: AuditEntry): string {
  const d = entry.details as Record<string, unknown>;
  switch (entry.action) {
    case "btc_address_changed":
      return `BTC · ${d.previous ? `${String(d.previous)} → ` : ""}${String(d.new)}`;
    case "deposit_address_changed":
      return `${methodName(d.method)} · ${d.previous ? `${String(d.previous)} → ` : ""}${String(d.new)}`;
    case "deposits_enabled":
    case "deposits_disabled":
      return methodName(d.method);
    case "deposit_approved":
      return `${entry.targetId} · ${methodName(d.method)} · account ${String(d.accountNumber)} · ${formatMoney(Number(d.amountUsd))} · ${String(d.confirmations)} conf.`;
    case "deposit_rejected":
      return `${entry.targetId} · ${methodName(d.method)} · account ${String(d.accountNumber)} · ${formatMoney(Number(d.amountUsd))} · reason: ${String(d.reason)}`;
    default:
      return entry.targetId ?? "";
  }
}

/** One row of the payment request list, with APPROVE / REJECT for pending requests. */
function DepositRow({
  deposit,
  isNew,
  onSeen,
  onOpen,
  onChanged,
  notify,
}: {
  deposit: AdminDeposit;
  isNew: boolean;
  onSeen: () => void;
  onOpen: () => void;
  onChanged: () => Promise<void>;
  notify: (toast: Toast) => void;
}) {
  const [mode, setMode] = useState<"none" | "approve" | "reject">("none");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = deposit.status === "reviewing";
  const info = METHOD_INFO[deposit.method];

  async function run(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError(null);
    try {
      await admin(body);
      notify({ type: "ok", message: success });
      setMode("none");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={`rounded-2xl border p-4 text-[12px] ${
        isNew
          ? "border-amber-400 bg-amber-50 shadow-[0_0_0_3px_rgba(245,158,11,0.18)]"
          : pending
            ? "border-purple-300 bg-purple-50/50"
            : "border-slate-100 bg-white"
      }`}
      data-testid="deposit-row"
      data-reference={deposit.reference}
      data-new={isNew ? "true" : undefined}
    >
      {isNew && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone="amber">NEW PAYMENT REQUEST</Badge>
          <button onClick={onSeen} className="text-[11px] font-bold text-amber-700 hover:underline">
            Mark as seen
          </button>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-[1.3fr_1fr_1.2fr_auto] sm:items-center">
        <div className="min-w-0">
          <p className="truncate font-black">{deposit.userName ?? deposit.user.name}</p>
          <p className="font-mono text-slate-500">{formatAccountNumber(deposit.user.accountNumber)}</p>
          <p className="font-mono text-slate-400">{deposit.reference}</p>
        </div>
        <div>
          <p className="flex flex-wrap items-center gap-1.5 font-black">
            {formatMoney(deposit.amountUsd)}
            <Badge tone={deposit.method === "usdt_trc20" ? "green" : "amber"}>{info.short}</Badge>
          </p>
          <p className="font-mono text-slate-500">{deposit.amountCrypto} {deposit.asset}</p>
          <p className="truncate font-mono text-[11px] text-slate-400" title={deposit.depositAddress}>
            To {shortHash(deposit.depositAddress, 6)} · {info.networkLabel}
          </p>
        </div>
        <div className="min-w-0">
          <p className="truncate font-mono text-slate-500" title={deposit.txid ?? ""}>
            TXID: {deposit.txid ? shortHash(deposit.txid, 8) : "—"}
          </p>
          <p className="text-slate-400">{formatDate(deposit.submittedAt ?? deposit.createdAt)}</p>
          {deposit.reviewedAt && (
            <p className="text-slate-400">
              {deposit.status === "approved" ? "Approved" : "Decided"} {formatDate(deposit.reviewedAt)}
              {deposit.reviewedBy ? ` by ${deposit.reviewedBy}` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Badge tone={STATUS_TONE[deposit.status]}>{DEPOSIT_STATUS_LABEL[deposit.status]}</Badge>
          <button onClick={onOpen} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-bold text-slate-600 hover:text-[#7F00FF]">
            Details
          </button>
        </div>
      </div>

      {pending && mode === "none" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => setMode("approve")} className={`${button} h-10 bg-emerald-600 text-white hover:bg-emerald-700`}>
            <CheckCircle2 className="h-4 w-4" /> APPROVE
          </button>
          <button onClick={() => setMode("reject")} className={`${button} h-10 bg-rose-600 text-white hover:bg-rose-700`}>
            <XCircle className="h-4 w-4" /> REJECT
          </button>
        </div>
      )}

      {pending && mode === "approve" && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="font-bold text-emerald-900">
            Approve {formatMoney(deposit.amountUsd)} ({deposit.amountCrypto} {deposit.asset}) for {deposit.userName ?? deposit.user.name},
            account {formatAccountNumber(deposit.user.accountNumber)}? The transaction is verified on the{" "}
            {deposit.method === "usdt_trc20" ? "TRON blockchain (official USDT TRC20 contract)" : "Bitcoin blockchain"} first
            (address, exact amount, confirmations, TXID not used before); the balance changes only if every check passes.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => run({ action: "approve", id: deposit.id }, `Payment ${deposit.reference} approved and balance credited.`)}
              disabled={busy}
              className={`${button} h-10 bg-emerald-600 text-white hover:bg-emerald-700`}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Verify &amp; approve
            </button>
            <button onClick={() => { setMode("none"); setError(null); }} disabled={busy} className={`${button} h-10 border border-slate-200 bg-white text-slate-700`}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {pending && mode === "reject" && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
          <label htmlFor={`reason-${deposit.id}`} className="font-bold text-rose-900">Reason for rejection (sent to the member)</label>
          <textarea
            id={`reason-${deposit.id}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            className="mt-1.5 w-full rounded-xl border border-rose-200 bg-white p-2.5 text-base focus:outline-none focus:ring-2 focus:ring-rose-100 sm:text-[13px]"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => run({ action: "reject", id: deposit.id, reason }, `Payment ${deposit.reference} rejected.`)}
              disabled={busy || reason.trim().length < 3}
              className={`${button} h-10 bg-rose-600 text-white hover:bg-rose-700`}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              Confirm rejection
            </button>
            <button onClick={() => { setMode("none"); setError(null); }} disabled={busy} className={`${button} h-10 border border-slate-200 bg-white text-slate-700`}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {deposit.rejectionReason && <p className="mt-2 text-rose-600">Reason: {deposit.rejectionReason}</p>}
      {error && (
        <p role="alert" className="mt-2 rounded-xl border border-rose-200 bg-white px-3 py-2 font-semibold text-rose-600">
          {error}
        </p>
      )}
    </li>
  );
}

const button =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50";
const inputClass =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-base font-semibold text-slate-800 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100 sm:text-[13px]";

const admin = <T,>(body: Record<string, unknown>) => postJson<T>("/api/admin", body, "/admin");

/* ---------------------------------------------------------------------------------------------- */

function VerificationView({ verification }: { verification: DepositVerification }) {
  const info = methodInfo(verification.method);
  return (
    <div className={`rounded-2xl border p-4 ${verification.matched ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`} data-testid="verification">
      <p className={`text-[13px] font-black ${verification.matched ? "text-emerald-800" : "text-rose-700"}`}>
        {verification.matched
          ? `Payment verified on the ${verification.method === "usdt_trc20" ? "TRON" : "Bitcoin"} blockchain`
          : "Payment NOT verified"}
      </p>
      <ul className="mt-3 space-y-2 text-[12px]">
        {verification.checks.map((check) => (
          <li key={check.label} className="flex items-start gap-2">
            {check.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : check.advisory ? (
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            )}
            <span className="min-w-0">
              <span className="font-bold">{check.label}{!check.ok && check.advisory ? " (warning — does not block approval)" : ""}</span>
              <span className="block break-all text-slate-600">{check.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-slate-500">Checked {formatDate(verification.checkedAt)} · {info.networkLabel}</p>
    </div>
  );
}

function DepositDetail({
  id,
  onClose,
  onChanged,
  notify,
}: {
  id: number;
  onClose: () => void;
  onChanged: () => Promise<void>;
  notify: (toast: Toast) => void;
}) {
  const [deposit, setDeposit] = useState<AdminDepositDetail | null>(null);
  const [verification, setVerification] = useState<DepositVerification | null>(null);
  const [busy, setBusy] = useState<"verify" | "approve" | "reject" | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await admin<{ deposit: AdminDepositDetail }>({ action: "deposit", id });
    setDeposit(response.deposit);
  }, [id]);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Could not load the request."));
  }, [load]);

  async function verify() {
    setBusy("verify");
    setError(null);
    try {
      const response = await admin<{ verification: DepositVerification }>({ action: "verify", id });
      setVerification(response.verification);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    setBusy("approve");
    setError(null);
    try {
      await admin({ action: "approve", id });
      notify({ type: "ok", message: "Deposit approved and balance credited." });
      await Promise.all([load(), onChanged()]);
      setConfirmApprove(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed.");
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    setBusy("reject");
    setError(null);
    try {
      await admin({ action: "reject", id, reason });
      notify({ type: "ok", message: "Deposit rejected. The user was notified." });
      setReason("");
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rejection failed.");
    } finally {
      setBusy(null);
    }
  }

  const info = deposit ? METHOD_INFO[deposit.method] : METHOD_INFO.btc;
  const reviewable = deposit?.status === "reviewing";
  const rejectable = deposit?.status === "reviewing" || deposit?.status === "awaiting_payment";

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-[#10152b]/50 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Deposit request">
      <div className="h-full w-full max-w-[640px] overflow-y-auto bg-[#f7f7fb] p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-3">
          <p className="text-lg font-black">Deposit request</p>
          {deposit && <Badge tone={STATUS_TONE[deposit.status]}>{DEPOSIT_STATUS_LABEL[deposit.status]}</Badge>}
          <button onClick={onClose} className="ml-auto flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!deposit && !error && <Loader2 className="mx-auto mt-10 h-6 w-6 animate-spin text-[#7F00FF]" />}

        {deposit && (
          <div className="space-y-4">
            <Card>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">User</p>
              <dl className="mt-3 grid gap-3 text-[13px] sm:grid-cols-2">
                <div><dt className="text-[11px] text-slate-500">Name</dt><dd className="font-bold">{deposit.user.name}</dd></div>
                <div><dt className="text-[11px] text-slate-500">Email</dt><dd className="break-all font-bold">{deposit.user.email}</dd></div>
                <div><dt className="text-[11px] text-slate-500">Account number</dt><dd className="font-mono font-bold">{formatAccountNumber(deposit.user.accountNumber)}</dd></div>
                <div><dt className="text-[11px] text-slate-500">Current balance</dt><dd className="font-bold">{formatMoney(deposit.user.balance)}</dd></div>
              </dl>
            </Card>

            <Card>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Payment</p>
              <dl className="mt-3 grid gap-3 text-[13px] sm:grid-cols-2">
                <div><dt className="text-[11px] text-slate-500">Reference</dt><dd className="font-mono font-bold">{deposit.reference}</dd></div>
                <div><dt className="text-[11px] text-slate-500">Payment method</dt><dd className="font-bold" data-testid="detail-method">{info.name}</dd></div>
                <div><dt className="text-[11px] text-slate-500">Network</dt><dd className="font-bold">{info.networkLabel}</dd></div>
                <div><dt className="text-[11px] text-slate-500">Amount (credited)</dt><dd className="font-black text-[#7F00FF]">{formatMoney(deposit.amountUsd)}</dd></div>
                <div>
                  <dt className="text-[11px] text-slate-500">Expected {info.asset}</dt>
                  <dd className="font-mono font-bold">
                    {deposit.amountCrypto} {info.asset}
                    {deposit.method === "btc" ? ` (${deposit.amountUnits.toLocaleString("en-US")} sats)` : ""}
                  </dd>
                </div>
                <div><dt className="text-[11px] text-slate-500">Rate</dt><dd className="font-bold">{formatMoney(deposit.usdRate)} / {info.asset} · {deposit.rateSource}</dd></div>
                <div className="sm:col-span-2"><dt className="text-[11px] text-slate-500">Deposit address of this request ({info.networkLabel})</dt><dd className="break-all font-mono text-[12px] font-bold">{deposit.depositAddress}</dd></div>
                <div><dt className="text-[11px] text-slate-500">Created</dt><dd>{formatDate(deposit.createdAt)}</dd></div>
                <div><dt className="text-[11px] text-slate-500">Quote valid until</dt><dd>{formatDate(deposit.expiresAt)}</dd></div>
                {deposit.submittedAt && <div><dt className="text-[11px] text-slate-500">&quot;I&apos;ve paid&quot; at</dt><dd>{formatDate(deposit.submittedAt)}</dd></div>}
                {deposit.reviewedAt && <div><dt className="text-[11px] text-slate-500">Reviewed</dt><dd>{formatDate(deposit.reviewedAt)}{deposit.reviewedBy ? ` by ${deposit.reviewedBy}` : ""}</dd></div>}
                <div className="sm:col-span-2">
                  <dt className="text-[11px] text-slate-500">Transaction ID (TXID)</dt>
                  <dd className="mt-1 flex flex-wrap items-center gap-2">
                    {deposit.txid ? (
                      <>
                        <code className="min-w-0 flex-1 break-all text-[12px] font-bold">{deposit.txid}</code>
                        <CopyButton value={deposit.txid} label="Copy" />
                        <a href={info.explorerTx(deposit.txid)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[12px] font-bold text-[#7F00FF] hover:underline">
                          {info.explorerName} <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </>
                    ) : (
                      <span className="text-slate-400">Not submitted yet</span>
                    )}
                  </dd>
                </div>
                {deposit.rejectionReason && <div className="sm:col-span-2"><dt className="text-[11px] text-slate-500">Rejection reason</dt><dd className="text-rose-600">{deposit.rejectionReason}</dd></div>}
              </dl>
            </Card>

            {deposit.txid && (
              <Card>
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-[13px] font-black">Blockchain check</p>
                  <button onClick={verify} disabled={busy !== null} className={`${button} ml-auto border border-slate-200 bg-white text-slate-700 hover:text-[#7F00FF]`}>
                    {busy === "verify" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Check TXID on blockchain
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  {deposit.method === "usdt_trc20"
                    ? "Reads TRON mainnet via TronGrid (full + solidity node). Requires a successful transfer of the official USDT TRC20 contract, the exact amount to the address above, solidification and at least "
                    : "Reads mempool.space and blockstream.info. Requires the exact amount to the address above and at least "}
                  {deposit.requiredConfirmations} confirmations.
                </p>
                <div className="mt-3">
                  {verification ? (
                    <VerificationView verification={verification} />
                  ) : deposit.verification ? (
                    <VerificationView verification={deposit.verification} />
                  ) : null}
                </div>
              </Card>
            )}

            {(reviewable || rejectable) && (
              <Card>
                <p className="text-[13px] font-black">Decision</p>
                {reviewable && (
                  <div className="mt-3">
                    {!confirmApprove ? (
                      <button
                        onClick={() => setConfirmApprove(true)}
                        disabled={busy !== null || !verification?.matched}
                        className={`${button} w-full bg-emerald-600 text-white hover:bg-emerald-700`}
                        title={verification?.matched ? "" : "Run a successful blockchain check first"}
                      >
                        <CheckCircle2 className="h-4 w-4" /> Approve payment
                      </button>
                    ) : (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                        <p className="text-[13px] font-bold text-emerald-900">
                          Credit {formatMoney(deposit.amountUsd)} to {deposit.user.name} ({formatAccountNumber(deposit.user.accountNumber)})?
                        </p>
                        <dl className="mt-2 grid gap-x-4 gap-y-1 text-[12px] text-emerald-900 sm:grid-cols-2" data-testid="approve-summary">
                          <div><dt className="inline opacity-70">Method: </dt><dd className="inline font-bold">{info.name}</dd></div>
                          <div><dt className="inline opacity-70">Amount: </dt><dd className="inline font-bold">{deposit.amountCrypto} {info.asset} = {formatMoney(deposit.amountUsd)}</dd></div>
                          <div className="sm:col-span-2 break-all"><dt className="inline opacity-70">TXID: </dt><dd className="inline font-mono">{deposit.txid}</dd></div>
                        </dl>
                        <p className="mt-2 text-[12px] text-emerald-900">
                          The blockchain is checked again before the balance changes.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button onClick={approve} disabled={busy !== null} className={`${button} bg-emerald-600 text-white hover:bg-emerald-700`}>
                            {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            Yes, approve
                          </button>
                          <button onClick={() => setConfirmApprove(false)} disabled={busy !== null} className={`${button} border border-slate-200 bg-white text-slate-700`}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {!verification?.matched && (
                      <p className="mt-2 text-[11px] text-slate-500">Approval is available after a successful blockchain check.</p>
                    )}
                  </div>
                )}
                {rejectable && (
                  <div className="mt-4">
                    <label htmlFor="reject-reason" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      Rejection reason (sent to the user)
                    </label>
                    <textarea
                      id="reject-reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      rows={3}
                      maxLength={500}
                      className="w-full rounded-xl border border-slate-200 bg-white p-3 text-base focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100 sm:text-[13px]"
                    />
                    <button onClick={reject} disabled={busy !== null || reason.trim().length < 3} className={`${button} mt-2 w-full bg-rose-600 text-white hover:bg-rose-700`}>
                      {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                      Reject payment
                    </button>
                  </div>
                )}
              </Card>
            )}

            <Card>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">User&apos;s recent transactions</p>
              {deposit.userTransactions.length === 0 ? (
                <p className="mt-3 text-[12px] text-slate-500">None.</p>
              ) : (
                <ul className="mt-2 divide-y divide-slate-100 text-[12px]">
                  {deposit.userTransactions.map((tx) => (
                    <li key={tx.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                      <span className="font-mono text-slate-500">{tx.reference}</span>
                      <span className="font-bold">{TX_TYPE_LABEL[tx.type] ?? tx.type}</span>
                      <span>{tx.direction === "in" ? "+" : "−"}{formatMoney(tx.amount, tx.currency)}</span>
                      <span className="ml-auto"><Badge tone={STATUS_TONE[tx.status]}>{TX_STATUS_LABEL[tx.status] ?? tx.status}</Badge></span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-[12px] font-semibold text-rose-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */

/** Admin card for one payment method: on/off switch and deposit address (stored in the database). */
function PaymentMethodCard({
  config,
  onChanged,
  notify,
}: {
  config: MethodConfig;
  onChanged: () => Promise<void>;
  notify: (toast: Toast) => void;
}) {
  const info = METHOD_INFO[config.method];
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const inputId = `address-${config.method}`;

  async function toggle() {
    setToggling(true);
    try {
      const response = await admin<{ enabled: boolean }>({ action: "setMethodEnabled", method: config.method, enabled: !config.enabled });
      notify({ type: "ok", message: `${info.name} payments are now ${response.enabled ? "active" : "inactive"}.` });
      await onChanged();
    } catch (err) {
      notify({ type: "error", message: err instanceof Error ? err.message : "Could not change the setting." });
    } finally {
      setToggling(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const response = await admin<{ address: string }>({ action: "setDepositAddress", method: config.method, address });
      notify({ type: "ok", message: `${info.short} deposit address saved: ${shortHash(response.address, 8)}` });
      setAddress("");
      await onChanged();
    } catch (err) {
      notify({ type: "error", message: err instanceof Error ? err.message : "Could not save the address." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <div data-testid={`method-card-${config.method}`} className="space-y-5 text-[13px]">
        <SectionTitle
          eyebrow={info.asset}
          title={info.name}
          action={<Badge tone={config.method === "usdt_trc20" ? "red" : "amber"}>Network: {info.networkLabel}</Badge>}
        />
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 p-4">
          <div className="min-w-0 flex-1">
            <p className="font-black">{info.name} payment method</p>
            <p className="mt-0.5 text-[12px] text-slate-500">
              When inactive, members cannot create new {info.short} payment requests. Requests already created can still be completed and reviewed.
            </p>
          </div>
          <Badge tone={config.enabled ? "green" : "red"}>{config.enabled ? "Active" : "Inactive"}</Badge>
          <button
            onClick={toggle}
            disabled={toggling}
            role="switch"
            aria-checked={config.enabled}
            aria-label={`${info.short} payment method active`}
            className={`relative h-8 w-14 shrink-0 rounded-full transition ${config.enabled ? "bg-emerald-500" : "bg-slate-300"}`}
          >
            <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${config.enabled ? "left-7" : "left-1"}`} />
          </button>
        </div>

        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Current deposit address</p>
          {config.address ? (
            <>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <code className="min-w-0 flex-1 break-all font-bold" data-testid="current-address">{config.address}</code>
                <CopyButton value={config.address} />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500" data-testid="address-updated">
                Last updated: {config.addressUpdatedAt ? formatDate(config.addressUpdatedAt) : "—"}
                {config.addressUpdatedBy ? ` by ${config.addressUpdatedBy}` : ""}
              </p>
            </>
          ) : (
            <p className="mt-1.5 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
              Not configured — members cannot pay with {info.short} until you add an address.
            </p>
          )}
        </div>
        <div>
          <label htmlFor={inputId} className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
            {config.address ? "Change address" : "Add address"} (
            {config.method === "usdt_trc20" ? "TRON mainnet: T…, 34 characters" : "Bitcoin Mainnet: bc1…, 1… or 3…"})
          </label>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <input
              id={inputId}
              value={address}
              onChange={(event) => setAddress(event.target.value.trim())}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={`${inputClass} font-mono`}
            />
            <button onClick={save} disabled={saving || address.length < 26} className={`${button} igw-gradient text-white`}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {config.address ? "Update address" : "Add address"}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">
            {config.method === "usdt_trc20"
              ? "Enter your own TRON wallet address that can receive USDT TRC20. The Base58Check checksum is verified; the USDT contract address itself is refused."
              : "The checksum is verified and testnet addresses are refused."}{" "}
            New payment requests and the QR code use the new address immediately; requests already created keep the address they were shown.
          </p>
        </div>
        <dl className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2">
          <div><dt className="text-[11px] text-slate-500">Confirmations required</dt><dd className="font-bold">{config.requiredConfirmations}</dd></div>
          <div><dt className="text-[11px] text-slate-500">Verification</dt><dd className="font-bold">{config.method === "usdt_trc20" ? "TronGrid · USDT contract TR7NHq…Lj6t" : "mempool.space + blockstream.info"}</dd></div>
        </dl>
      </div>
    </Card>
  );
}

/** Setup status (database version, server keys). Problems here are why payments cannot work. */
function StatusPanel({ status, onRecheck, full }: { status: StatusItem[]; onRecheck: () => Promise<void>; full?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [chain, setChain] = useState<{ btc: { ok: boolean; detail: string }; tron: { ok: boolean; detail: string } } | null>(null);
  const problems = status.filter((s) => !s.ok && s.required);
  const items = full ? status : problems;
  if (!full && problems.length === 0) return null;

  async function recheck() {
    setBusy(true);
    try {
      await onRecheck();
    } finally {
      setBusy(false);
    }
  }
  async function testChain() {
    setBusy(true);
    try {
      setChain(await admin<{ btc: { ok: boolean; detail: string }; tron: { ok: boolean; detail: string } }>({ action: "testChain" }));
    } catch (err) {
      setChain({ btc: { ok: false, detail: err instanceof Error ? err.message : "failed" }, tron: { ok: false, detail: "" } });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`rounded-2xl border p-4 text-[12px] ${problems.length ? "border-rose-300 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}
      data-testid={full ? "status-panel" : "setup-problems"}
      role={problems.length ? "alert" : undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className={`text-[13px] font-black ${problems.length ? "text-rose-700" : "text-emerald-800"}`}>
          {problems.length ? "Setup problem — payments cannot work until this is fixed" : "System status: OK"}
        </p>
        <button onClick={recheck} disabled={busy} className="ml-auto rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-bold text-slate-600">
          {busy ? "Checking…" : "Check again"}
        </button>
        {full && (
          <button onClick={testChain} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-bold text-slate-600">
            Test blockchain connections
          </button>
        )}
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((s) => (
          <li key={s.key} className="flex items-start gap-2" data-status={s.key} data-ok={s.ok ? "true" : "false"}>
            {s.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : s.required ? (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            ) : (
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            )}
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <b>{s.label}</b> — {s.detail}
            </span>
          </li>
        ))}
        {chain &&
          [
            ["Bitcoin explorers", chain.btc],
            ["TronGrid (USDT TRC20)", chain.tron],
          ].map(([label, r]) => {
            const result = r as { ok: boolean; detail: string };
            return (
              <li key={String(label)} className="flex items-start gap-2" data-testid="chain-test">
                {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />}
                <span className="min-w-0 [overflow-wrap:anywhere]"><b>{String(label)}</b> — {result.detail}</span>
              </li>
            );
          })}
      </ul>
    </div>
  );
}

/** Sound alert settings (stored in this browser). */
function SoundControls({
  sound,
  onChange,
  blocked,
  onUnlock,
}: {
  sound: SoundSettings;
  onChange: (next: SoundSettings) => void;
  blocked: boolean;
  onUnlock: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-[12px]" data-testid="sound-controls">
      <Bell className="h-4 w-4 text-[#7F00FF]" />
      <span className="font-bold">Sound alert for new payment requests</span>
      <button
        role="switch"
        aria-checked={sound.enabled}
        aria-label="Sound alerts"
        onClick={() => onChange({ ...sound, enabled: !sound.enabled })}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${sound.enabled ? "bg-emerald-500" : "bg-slate-300"}`}
      >
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${sound.enabled ? "left-6" : "left-1"}`} />
      </button>
      <label className="flex items-center gap-2">
        <span className="text-slate-500">Volume</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(sound.volume * 100)}
          aria-label="Alert volume"
          onChange={(event) => onChange({ ...sound, volume: Number(event.target.value) / 100 })}
          className="w-28 accent-[#7F00FF]"
        />
        <span className="w-9 text-right font-mono">{Math.round(sound.volume * 100)}%</span>
      </label>
      <button
        onClick={async () => {
          await onUnlock();
          playChime(sound.volume);
        }}
        className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-bold text-slate-600 hover:text-[#7F00FF]"
      >
        Test sound
      </button>
      {sound.enabled && blocked && (
        <button onClick={onUnlock} className="rounded-lg bg-amber-100 px-2.5 py-1.5 font-bold text-amber-800" data-testid="sound-blocked">
          Browser blocked sound — click to enable
        </button>
      )}
    </div>
  );
}

export default function AdminClient({
  initialOverview,
  initialDeposits,
  initialStatus,
}: {
  initialOverview: AdminOverview;
  initialDeposits: AdminDeposit[];
  initialStatus: StatusItem[];
}) {
  const [overview, setOverview] = useState(initialOverview);
  const [deposits, setDeposits] = useState(initialDeposits);
  const [filter, setFilter] = useState<string | null>("reviewing");
  const [transactions, setTransactions] = useState<AdminTransaction[] | null>(null);
  const [view, setView] = useState<View>("notifications");
  const [openId, setOpenId] = useState<number | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | null>(null);
  const [status, setStatus] = useState(initialStatus);
  // requestId -> notificationId of payment requests this admin has not seen yet
  const [newRequests, setNewRequests] = useState<Map<number, number>>(
    () =>
      new Map(
        initialOverview.notifications
          .filter((n) => n.kind === "deposit_submitted" && !n.read && typeof n.data?.requestId === "number")
          .map((n) => [Number(n.data.requestId), n.id] as [number, number]),
      ),
  );
  const [sound, setSound] = useState<SoundSettings>({ enabled: true, volume: 0.7 });
  const [audioBlocked, setAudioBlocked] = useState(false);
  const soundRef = useRef(sound);
  const lastSeenRef = useRef<number | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const refresh = useCallback(async () => {
    const [o, d] = await Promise.all([
      admin<{ overview: AdminOverview }>({ action: "overview" }),
      admin<{ deposits: AdminDeposit[] }>({ action: "deposits", status: null }),
    ]);
    setOverview(o.overview);
    setDeposits(d.deposits);
  }, []);

  const recheckStatus = useCallback(async () => {
    const response = await admin<{ status: StatusItem[] }>({ action: "status" });
    setStatus(response.status);
  }, []);

  // Sound settings + unlocking audio on the first interaction (browser autoplay rules).
  useEffect(() => {
    const saved = loadSoundSettings();
    setSound(saved);
    soundRef.current = saved;
    lastSeenRef.current = loadLastSeen();
    setAudioBlocked(isBlocked());
    const unlock = () => {
      unlockAudio().then((ok) => setAudioBlocked(!ok));
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  function changeSound(next: SoundSettings) {
    setSound(next);
    soundRef.current = next;
    saveSoundSettings(next);
  }

  // Polling (Vercel has no WebSocket server and the browser never talks to the
  // database directly): every 5 s while visible, every 15 s in the background.
  // The sound plays once per new request: the highest announced request id is
  // remembered in this browser, so refreshes and other tabs do not repeat it.
  const poll = useCallback(async () => {
    const { poll: p } = await admin<{ poll: AdminPoll }>({ action: "poll" });
    setNewRequests(new Map(p.newRequests.map((n) => [n.requestId, n.notificationId] as [number, number])));
    setOverview((o) => ({
      ...o,
      unreadCount: p.unreadCount,
      counts: { ...o.counts, reviewing: p.reviewing, approved: p.approved, rejected: p.rejected, new: p.newRequests.length },
    }));
    const latest = p.latestRequestNotificationId ?? 0;
    const stored = loadLastSeen();
    const seen = Math.max(lastSeenRef.current ?? -1, stored ?? -1);
    if (seen < 0) {
      // First visit in this browser: existing requests are not "new" for the sound.
      lastSeenRef.current = latest;
      saveLastSeen(latest);
      return;
    }
    if (latest > seen) {
      lastSeenRef.current = latest;
      saveLastSeen(latest);
      const fresh = p.newRequests.filter((n) => n.notificationId > seen);
      if (soundRef.current.enabled && !playChime(soundRef.current.volume)) setAudioBlocked(true);
      const last = fresh[fresh.length - 1];
      setToast({
        type: "ok",
        message: last
          ? `New payment request: ${last.userName} · ${formatMoney(last.amountUsd)} · ${methodInfo(last.method).short}`
          : "New payment request",
      });
      await refresh();
    } else {
      lastSeenRef.current = seen;
    }
  }, [refresh]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        await poll();
      } catch {
        /* network hiccup: try again next tick */
      }
      if (!stopped) timer = setTimeout(tick, document.visibilityState === "visible" ? 5000 : 15000);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [poll]);

  async function markSeen(requestId: number) {
    const notificationId = newRequests.get(requestId);
    if (notificationId === undefined) return;
    setNewRequests((m) => {
      const next = new Map(m);
      next.delete(requestId);
      return next;
    });
    try {
      await admin({ action: "readNotifications", ids: [notificationId] });
    } catch {
      /* not critical */
    }
    refresh().catch(() => {});
  }

  useEffect(() => {
    document.title = overview.counts.reviewing > 0 ? `(${overview.counts.reviewing}) Admin · Insta Global Wallet` : "Admin · Insta Global Wallet";
  }, [overview.counts.reviewing]);

  useEffect(() => {
    if (view === "transactions" && transactions === null) {
      admin<{ transactions: AdminTransaction[] }>({ action: "transactions" })
        .then((r) => setTransactions(r.transactions))
        .catch((err) => setToast({ type: "error", message: err instanceof Error ? err.message : "Could not load." }));
    }
  }, [view, transactions]);

  async function openNotification(id: number, requestId?: unknown) {
    try {
      await admin({ action: "readNotifications", ids: [id] });
    } catch {
      /* not critical */
    }
    if (typeof requestId === "number") setOpenId(requestId);
    refresh().catch(() => {});
  }

  const visibleDeposits = deposits.filter(
    (d) => (filter === null || d.status === filter) && (methodFilter === null || d.method === methodFilter),
  );
  const goTo = (id: View) => {
    setView(id);
    setMobileOpen(false);
  };

  return (
    <div lang="en" className="min-h-screen bg-[#f7f7fb] text-[#10152b]">
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col bg-[#10152b] text-white transition-transform duration-300 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-[76px] items-center justify-between border-b border-white/5 px-6">
          <Brand dark compact href="/admin" />
          <button className="text-white/60 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-1.5 px-4 py-6">
          <p className="mb-3 flex items-center gap-2 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
            <ShieldCheck className="h-3.5 w-3.5" /> Admin
          </p>
          {navItems.map((item) => {
            const Icon = item.icon;
            const count = item.id === "notifications" ? overview.unreadCount : item.id === "deposits" ? overview.counts.reviewing : 0;
            return (
              <button
                key={item.id}
                onClick={() => goTo(item.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-semibold transition ${
                  view === item.id ? "igw-gradient text-white" : "text-white/55 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" />
                {item.label}
                {count > 0 ? (
                  <span className="ml-auto rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-black">{count}</span>
                ) : (
                  view === item.id && <ChevronRight className="ml-auto h-4 w-4 opacity-70" />
                )}
              </button>
            );
          })}
          <Link href="/dashboard" className="mt-6 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-semibold text-white/55 hover:bg-white/5 hover:text-white">
            <Wallet className="h-[18px] w-[18px]" /> My wallet
          </Link>
        </nav>
        <div className="p-4">
          <p className="truncate px-2 text-[12px] font-semibold text-white">{overview.admin.name}</p>
          <p className="truncate px-2 text-[10px] text-white/40">@{overview.admin.username ?? overview.admin.email}</p>
          <form action={signOutAction}>
            <button type="submit" className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[12px] font-semibold text-white/50 hover:bg-white/5 hover:text-white">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </form>
        </div>
      </aside>
      {mobileOpen && <button className="fixed inset-0 z-40 bg-[#10152b]/60 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu" />}

      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur-xl">
          <div className="flex h-[68px] items-center gap-3 px-4 sm:px-8">
            <button className="text-slate-600 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <p className="text-sm font-extrabold">Admin · {navItems.find((n) => n.id === view)?.label}</p>
            {overview.counts.reviewing > 0 && (
              <button onClick={() => { setFilter("reviewing"); goTo("deposits"); }} className="ml-auto rounded-full bg-rose-500 px-3 py-1.5 text-[11px] font-black text-white">
                {overview.counts.reviewing} pending
              </button>
            )}
          </div>
        </header>

        <main className="mx-auto max-w-[1200px] space-y-6 px-4 py-6 sm:px-8">
          <StatusPanel status={status} onRecheck={recheckStatus} />
          {sound.enabled && audioBlocked && (
            <button
              onClick={() => unlockAudio().then((ok) => setAudioBlocked(!ok))}
              className="w-full rounded-2xl border border-amber-300 bg-amber-50 p-3 text-left text-[12px] font-bold text-amber-800"
              data-testid="sound-blocked-banner"
            >
              Sound alerts are blocked by the browser until you interact with the page. Click here to enable them.
            </button>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              ["New payments", overview.counts.new, "new", "text-amber-600"],
              ["Pending payments", overview.counts.reviewing, "pending", "text-[#7F00FF]"],
              ["Approved payments", overview.counts.approved, "approved", "text-emerald-600"],
              ["Rejected payments", overview.counts.rejected, "rejected", "text-rose-600"],
              ["Members", overview.counts.users, "members", ""],
            ].map(([label, value, key, tone]) => (
              <div key={String(key)} className="rounded-2xl border border-slate-100 bg-white p-4 igw-shadow-soft" data-testid={`count-${key}`}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
                <p className={`mt-1 text-xl font-black ${tone}`}>{value}</p>
                {(key === "pending" || key === "approved" || key === "rejected") && (
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    BTC {overview.counts.byMethod?.btc?.[key === "pending" ? "reviewing" : key] ?? 0} · USDT{" "}
                    {overview.counts.byMethod?.usdt_trc20?.[key === "pending" ? "reviewing" : key] ?? 0}
                  </p>
                )}
              </div>
            ))}
          </div>

          {view === "notifications" && (
            <Card>
              <SectionTitle
                eyebrow="Inbox"
                title="Notifications"
                action={overview.unreadCount > 0 ? (
                  <button onClick={async () => { await admin({ action: "readNotifications" }); await refresh(); }} className="text-[11px] font-bold text-[#7F00FF] hover:underline">
                    Mark all as read
                  </button>
                ) : undefined}
              />
              {overview.notifications.length === 0 ? (
                <p className="rounded-2xl bg-slate-50 p-6 text-center text-[13px] text-slate-500">No notifications.</p>
              ) : (
                <ul className="space-y-2.5">
                  {overview.notifications.map((n) => {
                    const d = n.data as Record<string, string | number | undefined>;
                    return (
                      <li key={n.id}>
                        <button
                          onClick={() => openNotification(n.id, d.requestId)}
                          className={`w-full rounded-2xl border p-4 text-left text-[12px] transition hover:border-purple-300 ${
                            n.read ? "border-slate-100 bg-white" : "border-[#7F00FF] bg-purple-50 shadow-[0_0_0_3px_rgba(127,0,255,0.08)]"
                          }`}
                          data-testid={n.read ? "notification" : "notification-new"}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            {!n.read && <Badge tone="purple">NEW</Badge>}
                            <p className="font-black">{n.title}</p>
                            <span className="ml-auto text-[10px] text-slate-400">{formatDate(n.createdAt)}</span>
                          </div>
                          {n.kind === "deposit_submitted" ? (
                            <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                              <div><dt className="inline text-slate-500">User: </dt><dd className="inline font-bold">{d.userName}</dd></div>
                              <div><dt className="inline text-slate-500">Account: </dt><dd className="inline font-mono font-bold">{d.accountNumber}</dd></div>
                              <div className="break-all"><dt className="inline text-slate-500">Email: </dt><dd className="inline">{d.email}</dd></div>
                              <div><dt className="inline text-slate-500">Method: </dt><dd className="inline font-bold">{methodInfo(String(d.method ?? "btc")).name}</dd></div>
                              <div><dt className="inline text-slate-500">Amount: </dt><dd className="inline font-bold">{formatMoney(Number(d.amountUsd))} · {d.amountCrypto ?? d.amountBtc} {d.asset ?? "BTC"}</dd></div>
                              <div><dt className="inline text-slate-500">Reference: </dt><dd className="inline font-mono">{d.reference}</dd></div>
                              <div><dt className="inline text-slate-500">Date: </dt><dd className="inline">{d.submittedAt ? formatDate(String(d.submittedAt)) : "—"}</dd></div>
                              <div><dt className="inline text-slate-500">Status: </dt><dd className="inline">{DEPOSIT_STATUS_LABEL[String(d.status)] ?? d.status}</dd></div>
                            </dl>
                          ) : (
                            <p className="mt-1 text-slate-600">{n.body}</p>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}

          {view === "deposits" && (
            <Card>
              <SectionTitle eyebrow="BTC · USDT TRC20" title="Payment requests" />
              <div className="mb-4">
                <SoundControls sound={sound} onChange={changeSound} blocked={audioBlocked} onUnlock={() => unlockAudio().then((ok) => setAudioBlocked(!ok))} />
              </div>
              <p className="mb-3 text-[11px] text-slate-500">
                Every request is decided manually: nothing is approved or rejected automatically, and requests never expire.
                Approval is possible only after the payment is verified on its blockchain.
              </p>
              <div className="-mx-1 mb-2 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Payment method filter">
                {METHOD_FILTERS.map((f) => (
                  <button
                    key={f.label}
                    onClick={() => setMethodFilter(f.id)}
                    aria-pressed={methodFilter === f.id}
                    className={`shrink-0 rounded-xl border px-3 py-1.5 text-[11px] font-bold ${methodFilter === f.id ? "border-[#7F00FF] bg-purple-50 text-[#7F00FF]" : "border-slate-200 bg-white text-slate-500"}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
                {FILTERS.map((f) => (
                  <button
                    key={f.label}
                    onClick={() => setFilter(f.id)}
                    className={`shrink-0 rounded-xl px-3 py-2 text-[12px] font-bold ${filter === f.id ? "igw-gradient text-white" : "bg-slate-100 text-slate-600"}`}
                  >
                    {f.label}
                    {f.id === "reviewing" && overview.counts.reviewing > 0 ? ` (${overview.counts.reviewing})` : ""}
                  </button>
                ))}
              </div>
              {visibleDeposits.length === 0 ? (
                <p className="rounded-2xl bg-slate-50 p-6 text-center text-[13px] text-slate-500">No requests.</p>
              ) : (
                <ul className="space-y-2.5">
                  {visibleDeposits.map((d) => (
                    <DepositRow
                      key={d.id}
                      deposit={d}
                      isNew={newRequests.has(d.id)}
                      onSeen={() => markSeen(d.id)}
                      onOpen={() => {
                        markSeen(d.id);
                        setOpenId(d.id);
                      }}
                      onChanged={refresh}
                      notify={setToast}
                    />
                  ))}
                </ul>
              )}
            </Card>
          )}

          {view === "transactions" && (
            <Card>
              <SectionTitle eyebrow="History" title="All transactions" />
              {transactions === null ? (
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#7F00FF]" />
              ) : transactions.length === 0 ? (
                <p className="rounded-2xl bg-slate-50 p-6 text-center text-[13px] text-slate-500">No transactions.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-[12px]">
                  {transactions.map((tx) => (
                    <li key={tx.id} className="grid gap-1 py-3 sm:grid-cols-[1.2fr_1fr_1fr_auto] sm:items-center">
                      <span className="min-w-0">
                        <span className="block truncate font-bold">{tx.user.name}</span>
                        <span className="block font-mono text-slate-500">{tx.user.accountNumber} · {tx.reference}</span>
                      </span>
                      <span>
                        <span className="block font-bold">{TX_TYPE_LABEL[tx.type] ?? tx.type}</span>
                        <span className="block truncate text-slate-500">{tx.description}</span>
                      </span>
                      <span className="text-slate-500">{formatDate(tx.createdAt)}</span>
                      <span className="flex items-center gap-2 sm:justify-end">
                        <b className={tx.direction === "in" ? "text-emerald-600" : ""}>{tx.direction === "in" ? "+" : "−"}{formatMoney(tx.amount, tx.currency)}</b>
                        <Badge tone={STATUS_TONE[tx.status]}>{TX_STATUS_LABEL[tx.status] ?? tx.status}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {view === "settings" && (
            <div className="space-y-6">
              <StatusPanel status={status} onRecheck={recheckStatus} full />
              <div className="grid gap-6 xl:grid-cols-2">
                {overview.settings.methods.map((config) => (
                  <PaymentMethodCard key={config.method} config={config} onChanged={refresh} notify={setToast} />
                ))}
              </div>
              <Card>
                <dl className="grid gap-3 text-[13px] sm:grid-cols-3">
                  <div><dt className="text-[11px] text-slate-500">Minimum per request</dt><dd className="font-bold">{formatMoney(overview.settings.minUsd)}</dd></div>
                  <div><dt className="text-[11px] text-slate-500">Maximum per request</dt><dd className="font-bold">{formatMoney(overview.settings.maxUsd)}</dd></div>
                  <div><dt className="text-[11px] text-slate-500">Payment window</dt><dd className="font-bold">{overview.settings.quoteMinutes} min</dd></div>
                </dl>
              </Card>
            </div>
          )}

          {view === "audit" && (
            <Card>
              <SectionTitle eyebrow="Security" title="Audit log" />
              {overview.auditLog.length === 0 ? (
                <p className="rounded-2xl bg-slate-50 p-6 text-center text-[13px] text-slate-500">No admin actions yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-[12px]" data-testid="audit-log">
                  {overview.auditLog.map((entry) => (
                    <li key={entry.id} className="grid gap-1 py-3 sm:grid-cols-[150px_120px_1fr] sm:items-start">
                      <span className="text-slate-500">{formatDate(entry.createdAt)}</span>
                      <span className="font-bold">@{entry.admin}</span>
                      <span className="min-w-0">
                        <span className="block font-black">{AUDIT_LABEL[entry.action] ?? entry.action}</span>
                        <span className="block text-slate-500 [overflow-wrap:anywhere]">{auditSummary(entry)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </main>
      </div>

      {openId !== null && (
        <DepositDetail id={openId} onClose={() => setOpenId(null)} onChanged={refresh} notify={setToast} />
      )}
      <ToastView toast={toast} />
    </div>
  );
}
