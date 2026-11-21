"use client";

import { KycBadge, KycPhotos } from "@/components/AdminKyc";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CreditCard, ExternalLink, Loader2, Search, XCircle } from "lucide-react";
import type { AdminCard, AdminCardRequest, AdminWithdrawal, MemberLookup } from "@/lib/admin";
import { CARD_TIERS, CARD_TIER_STYLE, formatValidThru, type CardTier } from "@/lib/cards";
import { formatAccountNumber, formatDate, formatMoney, isAccountNumber, normalizeAccountNumber } from "@/lib/format";
import { Badge, Card, CopyButton, STATUS_TONE, SectionTitle, postJson, type Toast } from "@/components/wallet-ui";
import { WITHDRAWAL_STATUS_LABEL } from "@/components/WithdrawSection";

const admin = <T,>(body: Record<string, unknown>) => postJson<T>("/api/admin", body, "/admin");
const button =
  "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-[12px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50";
const inputClass =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-base font-semibold text-slate-800 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100 sm:text-[13px]";
const limitText = (limit: number | null) => (limit === null ? "unlimited" : `${formatMoney(limit)} / 24 h`);

function TierBadge({ tier, name }: { tier: CardTier; name?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full bg-gradient-to-r px-2.5 py-1 text-[10px] font-black ${CARD_TIER_STYLE[tier].gradient} ${CARD_TIER_STYLE[tier].text}`}>
      {name ?? CARD_TIER_STYLE[tier].name}
    </span>
  );
}

/* ---------------------------------------------------------------------------------------------- */

function WithdrawalRow({
  w,
  isNew,
  onSeen,
  onChanged,
  notify,
}: {
  w: AdminWithdrawal;
  isNew: boolean;
  onSeen: () => void;
  onChanged: () => Promise<void>;
  notify: (toast: Toast) => void;
}) {
  const [mode, setMode] = useState<"none" | "approve" | "reject">("none");
  const [txid, setTxid] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = w.status === "pending";

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
        isNew ? "border-amber-400 bg-amber-50 shadow-[0_0_0_3px_rgba(245,158,11,0.18)]" : pending ? "border-purple-300 bg-purple-50/50" : "border-slate-100 bg-white"
      }`}
      data-testid="withdrawal-row"
      data-reference={w.reference}
      data-new={isNew ? "true" : undefined}
    >
      {isNew && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone="amber">NEW WITHDRAWAL REQUEST</Badge>
          <button onClick={onSeen} className="text-[11px] font-bold text-amber-700 hover:underline">Mark as seen</button>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-[1.2fr_1fr_1.6fr_auto] sm:items-center">
        <div className="min-w-0">
          <p className="truncate font-black">{w.userName}</p>
          <p className="font-mono text-slate-500">{formatAccountNumber(w.accountNumber)}</p>
          <p className="truncate text-slate-400">{w.user.email}</p>
          <p className="font-mono text-slate-400">{w.reference}</p>
        </div>
        <div>
          <p className="text-[15px] font-black">{formatMoney(w.amountUsd)}</p>
          <p className="mt-1"><TierBadge tier={w.cardTier} name={w.cardTierName} /></p>
          <p className="mt-1 text-slate-500">Balance now: {formatMoney(w.user.balance)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">To BTC address</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all font-bold" data-testid="withdrawal-address">{w.btcAddress}</code>
            <CopyButton value={w.btcAddress} label="Copy" />
          </div>
          <p className="text-slate-400">{formatDate(w.createdAt)}</p>
          {w.txid && (
            <a href={`https://mempool.space/tx/${w.txid}`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-mono text-[#7F00FF] hover:underline">
              TXID {w.txid.slice(0, 12)}… <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {w.reviewedAt && <p className="text-slate-400">Decided {formatDate(w.reviewedAt)}{w.reviewedBy ? ` by ${w.reviewedBy}` : ""}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Badge tone={STATUS_TONE[w.status]}>{WITHDRAWAL_STATUS_LABEL[w.status]}</Badge>
        </div>
      </div>

      {pending && mode === "none" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => setMode("approve")} className={`${button} bg-emerald-600 text-white hover:bg-emerald-700`}>
            <CheckCircle2 className="h-4 w-4" /> APPROVE
          </button>
          <button onClick={() => setMode("reject")} className={`${button} bg-rose-600 text-white hover:bg-rose-700`}>
            <XCircle className="h-4 w-4" /> REJECT
          </button>
        </div>
      )}
      {pending && mode === "approve" && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="font-bold text-emerald-900">
            Send {formatMoney(w.amountUsd)} in BTC from the company wallet to the address above, then mark it as sent. The amount
            was already taken from the member&apos;s balance.
          </p>
          <label htmlFor={`txid-${w.id}`} className="mt-2 block text-[11px] font-bold uppercase tracking-wide text-emerald-900">
            Transaction ID (TXID) — optional, shown to the member
          </label>
          <input id={`txid-${w.id}`} value={txid} onChange={(e) => setTxid(e.target.value.trim())} className={`${inputClass} mt-1 font-mono`} />
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => run({ action: "approveWithdrawal", id: w.id, txid }, `Withdrawal ${w.reference} marked as sent.`)} disabled={busy} className={`${button} bg-emerald-600 text-white hover:bg-emerald-700`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Mark as sent
            </button>
            <button onClick={() => { setMode("none"); setError(null); }} disabled={busy} className={`${button} border border-slate-200 bg-white text-slate-700`}>Cancel</button>
          </div>
        </div>
      )}
      {pending && mode === "reject" && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
          <label htmlFor={`reason-w-${w.id}`} className="font-bold text-rose-900">Reason for rejection (sent to the member; the amount is returned to the balance)</label>
          <textarea id={`reason-w-${w.id}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500}
            className="mt-1.5 w-full rounded-xl border border-rose-200 bg-white p-2.5 text-base focus:outline-none sm:text-[13px]" />
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => run({ action: "rejectWithdrawal", id: w.id, reason }, `Withdrawal ${w.reference} rejected; amount returned.`)} disabled={busy || reason.trim().length < 3} className={`${button} bg-rose-600 text-white hover:bg-rose-700`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Confirm rejection
            </button>
            <button onClick={() => { setMode("none"); setError(null); }} disabled={busy} className={`${button} border border-slate-200 bg-white text-slate-700`}>Cancel</button>
          </div>
        </div>
      )}
      {w.rejectionReason && <p className="mt-2 text-rose-600">Reason: {w.rejectionReason}</p>}
      {error && <p role="alert" className="mt-2 rounded-xl border border-rose-200 bg-white px-3 py-2 font-semibold text-rose-600">{error}</p>}
    </li>
  );
}

const W_FILTERS: { id: string | null; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Sent" },
  { id: "rejected", label: "Rejected" },
  { id: "cancelled", label: "Cancelled" },
  { id: null, label: "All" },
];

export function AdminWithdrawalsView({
  reloadKey,
  newIds,
  onSeen,
  onChanged,
  notify,
}: {
  reloadKey: number;
  newIds: Map<number, number>;
  onSeen: (notificationId: number) => void;
  onChanged: () => Promise<void>;
  notify: (toast: Toast) => void;
}) {
  const [rows, setRows] = useState<AdminWithdrawal[] | null>(null);
  const [filter, setFilter] = useState<string | null>("pending");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await admin<{ withdrawals: AdminWithdrawal[] }>({ action: "withdrawals" });
      setRows(r.withdrawals);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load withdrawals.");
    }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  const changed = async () => { await Promise.all([load(), onChanged()]); };
  const visible = (rows ?? []).filter((w) => filter === null || w.status === filter);
  const pendingCount = (rows ?? []).filter((w) => w.status === "pending").length;

  return (
    <Card>
      <SectionTitle eyebrow="Bitcoin" title="Withdrawal requests" />
      <p className="mb-3 text-[11px] text-slate-500">
        Members need an active card; the daily card limit and the balance are checked when the request is made, and the amount is
        reserved from the balance. APPROVE = you sent the BTC (TXID optional). REJECT returns the amount to the member.
      </p>
      <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
        {W_FILTERS.map((f) => (
          <button key={f.label} onClick={() => setFilter(f.id)}
            className={`shrink-0 rounded-xl px-3 py-2 text-[12px] font-bold ${filter === f.id ? "igw-gradient text-white" : "bg-slate-100 text-slate-600"}`}>
            {f.label}{f.id === "pending" && pendingCount > 0 ? ` (${pendingCount})` : ""}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-600">{error}</p>}
      {rows === null ? (
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#7F00FF]" />
      ) : visible.length === 0 ? (
        <p className="rounded-2xl bg-slate-50 p-6 text-center text-[13px] text-slate-500">No withdrawal requests.</p>
      ) : (
        <ul className="space-y-2.5">
          {visible.map((w) => (
            <WithdrawalRow key={w.id} w={w} isNew={newIds.has(w.id)} onSeen={() => onSeen(newIds.get(w.id)!)} onChanged={changed} notify={notify} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------------------------------------- */

function CardRequestRow({
  r,
  isNew,
  onChanged,
  notify,
}: {
  r: AdminCardRequest;
  isNew: boolean;
  onChanged: () => Promise<void>;
  notify: (toast: Toast) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = r.status === "pending";

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      await admin({ action: "decideCardRequest", id: r.id, approve, reason: approve ? null : reason });
      notify({ type: "ok", message: approve ? `${r.tierName} card activated for ${r.userName}.` : `Card request ${r.reference} rejected.` });
      setRejecting(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`rounded-2xl border p-4 text-[12px] ${isNew ? "border-amber-400 bg-amber-50" : pending ? "border-purple-300 bg-purple-50/50" : "border-slate-100 bg-white"}`}
      data-testid="card-request-row" data-reference={r.reference} data-new={isNew ? "true" : undefined}>
      <div className="grid gap-2 sm:grid-cols-[1.3fr_1fr_1fr_auto] sm:items-center">
        <div className="min-w-0">
          <p className="truncate font-black">{r.userName}</p>
          <p className="font-mono text-slate-500">{formatAccountNumber(r.accountNumber)}</p>
          <p className="truncate text-slate-400">{r.email}</p>
          <p className="font-mono text-slate-400">{r.reference} · {formatDate(r.createdAt)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Requested</p>
          <TierBadge tier={r.tier} name={r.tierName} />
          <p className="mt-1 text-slate-500">Limit {limitText(r.dailyLimit)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Current card</p>
          <p className="font-bold">{r.currentCard ? `${r.currentCard.tierName} · ${r.currentCard.status}` : "None"}</p>
          <p className="text-slate-500">Balance {formatMoney(r.balance)}</p>
        </div>
        <div className="flex sm:justify-end">
          <Badge tone={r.status === "pending" ? "purple" : r.status === "approved" ? "green" : r.status === "rejected" ? "red" : "slate"}>
            {r.status === "pending" ? "Pending" : r.status === "approved" ? "Activated" : r.status === "rejected" ? "Rejected" : "Cancelled"}
          </Badge>
        </div>
      </div>
      {r.note && <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-slate-600">Note: {r.note}</p>}
      {pending && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3" data-testid="card-request-kyc">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Identity documents</p>
            <KycBadge kyc={r.kyc} />
            {r.kyc && <span className="text-slate-500">{r.kyc.documentName} · {formatDate(r.kyc.createdAt)}</span>}
          </div>
          {r.kyc ? <KycPhotos kyc={r.kyc} compact /> : <p className="text-rose-600">No documents uploaded yet — the card cannot be activated until the member sends them.</p>}
          {r.kyc?.status === "pending" && <p className="mt-2 text-slate-500">Activating the card also marks these documents as verified. If they are not acceptable, reject them in Identity (KYC).</p>}
          {r.kyc?.status === "rejected" && <p className="mt-2 text-rose-600">These documents were rejected{r.kyc.rejectionReason ? `: ${r.kyc.rejectionReason}` : ""}.</p>}
        </div>
      )}
      {pending && !rejecting && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => decide(true)} disabled={busy || !r.kyc || r.kyc.status === "rejected"} className={`${button} bg-emerald-600 text-white hover:bg-emerald-700`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} {r.kyc?.status === "pending" ? "VERIFY ID & " : ""}ACTIVATE {r.tierName.toUpperCase()} CARD
          </button>
          <button onClick={() => setRejecting(true)} disabled={busy} className={`${button} bg-rose-600 text-white hover:bg-rose-700`}>
            <XCircle className="h-4 w-4" /> REJECT
          </button>
        </div>
      )}
      {pending && rejecting && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
          <label htmlFor={`reason-c-${r.id}`} className="font-bold text-rose-900">Reason for rejection (sent to the member)</label>
          <textarea id={`reason-c-${r.id}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500}
            className="mt-1.5 w-full rounded-xl border border-rose-200 bg-white p-2.5 text-base focus:outline-none sm:text-[13px]" />
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => decide(false)} disabled={busy || reason.trim().length < 3} className={`${button} bg-rose-600 text-white`}>Confirm rejection</button>
            <button onClick={() => setRejecting(false)} disabled={busy} className={`${button} border border-slate-200 bg-white text-slate-700`}>Cancel</button>
          </div>
        </div>
      )}
      {r.rejectionReason && <p className="mt-2 text-rose-600">Reason: {r.rejectionReason}</p>}
      {error && <p role="alert" className="mt-2 rounded-xl border border-rose-200 bg-white px-3 py-2 font-semibold text-rose-600">{error}</p>}
    </li>
  );
}

function ManageMemberCard({ onChanged, notify }: { onChanged: () => Promise<void>; notify: (toast: Toast) => void }) {
  const [account, setAccount] = useState("");
  const [member, setMember] = useState<MemberLookup | null>(null);
  const [tier, setTier] = useState<CardTier>("standard");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    setBusy(true);
    setError(null);
    try {
      const r = await admin<{ member: MemberLookup }>({ action: "lookupMember", accountNumber: account });
      setMember(r.member);
      if (r.member.card) setTier(r.member.card.tier);
    } catch (err) {
      setMember(null);
      setError(err instanceof Error ? err.message : "Not found.");
    } finally {
      setBusy(false);
    }
  }

  async function set(active: boolean) {
    if (!member) return;
    setBusy(true);
    setError(null);
    try {
      await admin({ action: "setCard", accountNumber: member.accountNumber, tier, active, reason: active ? null : reason });
      notify({ type: "ok", message: active ? `${CARD_TIER_STYLE[tier].name} card active for ${member.name}.` : `Card of ${member.name} deactivated.` });
      setReason("");
      await Promise.all([lookup(), onChanged()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 p-4" data-testid="manage-card">
      <p className="text-[13px] font-black">Activate, change or deactivate a member&apos;s card</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input value={account} onChange={(e) => setAccount(e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, ""))}
          aria-label="Member account number" placeholder="UK1234567 12345" autoCapitalize="characters" spellCheck={false} className={`${inputClass} font-mono uppercase`} />
        <button onClick={lookup} disabled={busy || !isAccountNumber(normalizeAccountNumber(account))} className={`${button} h-11 shrink-0 whitespace-nowrap border border-slate-200 bg-white text-slate-700`}>
          <Search className="h-4 w-4" /> Find member
        </button>
      </div>
      {member && (
        <div className="mt-3 space-y-3 text-[12px]" data-testid="member-found">
          <p>
            <b>{member.name}</b> · <span className="font-mono">{formatAccountNumber(member.accountNumber)}</span> · {member.email} · balance{" "}
            {formatMoney(member.balance)}
          </p>
          <p>
            Card:{" "}
            {member.card ? (
              <><TierBadge tier={member.card.tier} name={member.card.tierName} /> <Badge tone={member.card.status !== "active" ? "slate" : member.card.expired ? "amber" : "green"}>{member.card.status === "active" && member.card.expired ? "expired" : member.card.status}</Badge> · valid thru {formatValidThru(member.card.validUntil)} · used {formatMoney(member.usedLast24h)} in 24 h</>
            ) : (
              <b>none</b>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2" data-testid="member-kyc">
            Identity: <KycBadge kyc={member.kyc} />
            {member.kyc && <span className="text-slate-500">{member.kyc.documentName} · {formatDate(member.kyc.createdAt)}</span>}
          </div>
          {member.kyc && <KycPhotos kyc={member.kyc} compact />}
          {(!member.kyc || member.kyc.status === "rejected") && (
            <p className="text-amber-700">A card can only be activated after the member uploads identity documents (with a card request in their Withdraw section).</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="set-tier" className="font-bold">Card</label>
            <select id="set-tier" value={tier} onChange={(e) => setTier(e.target.value as CardTier)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 font-bold">
              {CARD_TIERS.map((t) => <option key={t} value={t}>{CARD_TIER_STYLE[t].name}</option>)}
            </select>
            <button onClick={() => set(true)} disabled={busy} className={`${button} bg-emerald-600 text-white hover:bg-emerald-700`}>
              <CreditCard className="h-4 w-4" /> {member.card?.status !== "active" ? "Activate card" : member.card.expired ? "Renew (3 years)" : "Change / keep active"}
            </button>
          </div>
          {member.card?.status === "active" && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for deactivation (optional, sent to the member)" aria-label="Deactivation reason" className={inputClass} />
              <button onClick={() => set(false)} disabled={busy} className={`${button} h-11 bg-rose-600 text-white hover:bg-rose-700`}>Deactivate card</button>
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-600">{error}</p>}
    </div>
  );
}

export function AdminCardsView({
  reloadKey,
  newIds,
  onChanged,
  notify,
}: {
  reloadKey: number;
  newIds: Map<number, number>;
  onChanged: () => Promise<void>;
  notify: (toast: Toast) => void;
}) {
  const [requests, setRequests] = useState<AdminCardRequest[] | null>(null);
  const [cards, setCards] = useState<AdminCard[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([
        admin<{ requests: AdminCardRequest[] }>({ action: "cardRequests" }),
        admin<{ cards: AdminCard[] }>({ action: "cards" }),
      ]);
      setRequests(r.requests);
      setCards(c.cards);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load cards.");
    }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);
  const changed = async () => { await Promise.all([load(), onChanged()]); };

  async function quick(card: AdminCard, active: boolean) {
    try {
      await admin({ action: "setCard", accountNumber: card.accountNumber, tier: card.tier, active, reason: null });
      notify({ type: "ok", message: active ? `Card of ${card.userName} activated.` : `Card of ${card.userName} deactivated.` });
      await changed();
    } catch (err) {
      notify({ type: "error", message: err instanceof Error ? err.message : "Action failed." });
    }
  }

  const shownRequests = (requests ?? []).filter((r) => showAll || r.status === "pending");

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle eyebrow="Cards" title="Card requests" action={
          <button onClick={() => setShowAll((v) => !v)} className="text-[11px] font-bold text-[#7F00FF] hover:underline">{showAll ? "Pending only" : "Show all"}</button>
        } />
        <p className="mb-3 text-[11px] text-slate-500">
          Members request a card (no fee). Withdrawals are possible only with an active card. Daily limits: Standard 750, Gold 1,250,
          Premium 5,000 USD, Merchant unlimited.
        </p>
        {error && <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-600">{error}</p>}
        {requests === null ? (
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#7F00FF]" />
        ) : shownRequests.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 p-6 text-center text-[13px] text-slate-500">No {showAll ? "" : "pending "}card requests.</p>
        ) : (
          <ul className="space-y-2.5">
            {shownRequests.map((r) => <CardRequestRow key={r.id} r={r} isNew={newIds.has(r.id)} onChanged={changed} notify={notify} />)}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle eyebrow="Cards" title="Member cards" />
        <ManageMemberCard onChanged={changed} notify={notify} />
        {cards && cards.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100 text-[12px]" data-testid="cards-list">
            {cards.map((c) => (
              <li key={c.accountNumber} className="grid gap-1 py-3 sm:grid-cols-[1.3fr_1fr_1fr_auto] sm:items-center">
                <span className="min-w-0">
                  <span className="block truncate font-bold">{c.userName}</span>
                  <span className="block font-mono text-slate-500">{formatAccountNumber(c.accountNumber)} · •••• {c.cardNumber.slice(-4)} · valid thru {formatValidThru(c.validUntil)}</span>
                </span>
                <span><TierBadge tier={c.tier} name={c.tierName} /> <span className="text-slate-500">{limitText(c.dailyLimit)}</span></span>
                <span className="text-slate-500">Used 24 h: {formatMoney(c.usedLast24h)}</span>
                <span className="flex items-center gap-2 sm:justify-end">
                  <Badge tone={c.status !== "active" ? "slate" : c.expired ? "amber" : "green"}>{c.status !== "active" ? "Inactive" : c.expired ? "Expired" : "Active"}</Badge>
                  <button onClick={() => quick(c, c.status !== "active")} className="rounded-lg border border-slate-200 px-2 py-1 font-bold text-slate-600 hover:text-[#7F00FF]">
                    {c.status === "active" ? "Deactivate" : "Activate"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
