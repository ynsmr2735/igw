"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Check, Copy, KeyRound, Loader2, Search, ShieldAlert, UserRound, Users } from "lucide-react";
import type { MemberDetail, MemberSummary } from "@/lib/admin";
import { KYC_STATUS_LABEL } from "@/lib/kyc";
import { formatAccountNumber, formatDate, formatMoney } from "@/lib/format";
import { KycBadge, KycPhotos } from "@/components/AdminKyc";
import { Badge, Card, SectionTitle, STATUS_TONE, postJson, type Toast } from "@/components/wallet-ui";

const button = "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-[12px] font-black transition disabled:opacity-50";

async function admin<T>(body: Record<string, unknown>): Promise<T> {
  return postJson<T>("/api/admin", body, "/admin");
}

function KycTone({ status }: { status: MemberSummary["kycStatus"] }) {
  const tone = status === "approved" ? "green" : status === "pending" ? "amber" : status === "rejected" ? "red" : "slate";
  return <Badge tone={tone}>ID: {KYC_STATUS_LABEL[status]}</Badge>;
}

function CardTone({ card }: { card: MemberSummary["card"] }) {
  if (!card) return <Badge>No card</Badge>;
  const label = `${card.tier[0].toUpperCase()}${card.tier.slice(1)}`;
  if (card.status !== "active") return <Badge>{label} · inactive</Badge>;
  return <Badge tone={card.expired ? "amber" : "green"}>{label}{card.expired ? " · expired" : ""}</Badge>;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Reset password: confirmation, then the temporary password shown once. */
function PasswordReset({ member, onDone, notify }: { member: MemberDetail; onDone: () => Promise<void>; notify: (t: Toast) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ temporaryPassword: string; sessionsEnded: number } | null>(null);
  const [copied, setCopied] = useState<"password" | "message" | null>(null);

  const site = typeof window === "undefined" ? "" : window.location.origin;
  const message = result
    ? `Hello ${member.name}, your Insta Global Wallet password was reset.\nTemporary password: ${result.temporaryPassword}\nSign in at ${site}/login with your email (${member.email}) and choose a new password right away.`
    : "";

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      const r = await admin<{ temporaryPassword: string; sessionsEnded: number }>({ action: "resetPassword", accountNumber: member.accountNumber });
      setResult(r);
      setConfirming(false);
      notify({ type: "ok", message: `Password of ${member.name} reset. Give the temporary password to the member.` });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reset the password.");
    } finally {
      setBusy(false);
    }
  }

  async function doCopy(kind: "password" | "message") {
    if (!result) return;
    const ok = await copy(kind === "password" ? result.temporaryPassword : message);
    setCopied(ok ? kind : null);
    if (!ok) notify({ type: "error", message: "Could not copy. Select the text and copy it manually." });
  }

  if (member.isAdmin) {
    return <p className="text-[12px] text-slate-500">Admin passwords cannot be reset here. An admin changes their own password in My wallet → Profile.</p>;
  }

  return (
    <div className="space-y-3" data-testid="password-reset">
      <p className="text-[12px] text-slate-600">
        Passwords are stored encrypted and can never be viewed. You can give the member a <b>new temporary password</b>: all their devices are
        signed out and they must choose their own password right after signing in.
      </p>
      {member.mustChangePassword && !result && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-800">
          A temporary password is active; the member has not set a new password yet.
        </p>
      )}
      {!confirming && !result && (
        <button onClick={() => setConfirming(true)} className={`${button} bg-[#10152b] text-white hover:bg-black`}>
          <KeyRound className="h-4 w-4" /> Reset password
        </button>
      )}
      {confirming && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-900" role="dialog" aria-label="Confirm password reset">
          <p className="flex items-start gap-2 font-bold">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            Make sure you are talking to the real account owner before resetting
          </p>
          <p className="mt-1">
            Ask for the email and account number{member.kyc.some((k) => k.status === "approved") ? " and compare their name with the verified ID below" : ""}. Anyone who gets the temporary password can access this wallet.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={reset} disabled={busy} className={`${button} bg-rose-600 text-white hover:bg-rose-700`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Yes, create temporary password
            </button>
            <button onClick={() => setConfirming(false)} disabled={busy} className={`${button} border border-slate-200 bg-white text-slate-700`}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {result && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-[12px] text-emerald-900" data-testid="temporary-password-box">
          <p className="font-bold">Temporary password (shown only now):</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="select-all rounded-lg bg-white px-3 py-2 font-mono text-[16px] font-black tracking-wider text-[#10152b]" data-testid="temporary-password">
              {result.temporaryPassword}
            </code>
            <button onClick={() => doCopy("password")} className={`${button} h-9 border border-emerald-300 bg-white text-emerald-800`}>
              {copied === "password" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy password
            </button>
            <button onClick={() => doCopy("message")} className={`${button} h-9 border border-emerald-300 bg-white text-emerald-800`}>
              {copied === "message" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy message for WhatsApp
            </button>
          </div>
          <p className="mt-2">{result.sessionsEnded > 0 ? `${result.sessionsEnded} open session(s) were signed out. ` : ""}The member must set a new password after signing in.</p>
        </div>
      )}
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-600">{error}</p>}
    </div>
  );
}

function Detail({ accountNumber, onBack, notify }: { accountNumber: string; onBack: () => void; notify: (t: Toast) => void }) {
  const [m, setM] = useState<MemberDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setM((await admin<{ member: MemberDetail }>({ action: "memberDetail", accountNumber })).member);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the member.");
    }
  }, [accountNumber]);

  useEffect(() => {
    void load();
  }, [load]);

  const row = "flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[12px]";

  return (
    <div className="space-y-6" data-testid="member-detail">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#7F00FF]">
        <ArrowLeft className="h-4 w-4" /> All members
      </button>
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-600">{error}</p>}
      {!m && !error && <p className="flex items-center gap-2 text-[12px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {m && (
        <>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-black">{m.name}</h2>
                  {m.isAdmin && <Badge tone="purple">Admin</Badge>}
                  {m.mustChangePassword && <Badge tone="amber">Temporary password</Badge>}
                </div>
                <p className="mt-1 break-all text-[13px] text-slate-600">{m.email}{m.username ? ` · @${m.username}` : ""}</p>
                <p className="mt-1 font-mono text-[14px] font-bold" data-testid="member-account">{formatAccountNumber(m.accountNumber)}</p>
                {m.previousAccountNumber && <p className="text-[11px] text-slate-400">Old account number: {formatAccountNumber(m.previousAccountNumber)}</p>}
              </div>
              <div className="text-right">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Balance</p>
                <p className="text-2xl font-black" data-testid="member-balance">{formatMoney(m.balance)}</p>
              </div>
            </div>
            <dl className="mt-5 grid gap-3 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-500">Member since</dt><dd className="mt-1 font-bold">{formatDate(m.createdAt)}</dd></div>
              <div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-500">Last active</dt><dd className="mt-1 font-bold">{m.lastSeenAt ? formatDate(m.lastSeenAt) : "—"} · {m.activeSessions} session(s)</dd></div>
              <div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-500">Card</dt><dd className="mt-1"><CardTone card={m.card} />{m.cardDetails && <span className="ml-1 text-slate-500">•••• {m.cardDetails.cardNumber.slice(-4)}</span>}</dd></div>
              <div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-500">Identity</dt><dd className="mt-1"><KycTone status={m.kycStatus} /></dd></div>
              <div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-500">Password last changed</dt><dd className="mt-1 font-bold">{m.passwordChangedAt ? formatDate(m.passwordChangedAt) : "—"}</dd></div>
              <div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-500">Withdrawn last 24 h</dt><dd className="mt-1 font-bold">{formatMoney(m.usedLast24h)}</dd></div>
              <div className="rounded-xl bg-slate-50 p-3 sm:col-span-2"><dt className="text-slate-500">Password resets by admin</dt><dd className="mt-1 font-bold">{m.passwordResets.length ? m.passwordResets.map((p) => `${formatDate(p.at)} (${p.by})`).join(", ") : "none"}</dd></div>
            </dl>
          </Card>

          <Card>
            <SectionTitle eyebrow="Security" title="Password" />
            <PasswordReset member={m} onDone={load} notify={notify} />
          </Card>

          <Card>
            <SectionTitle eyebrow="Identity" title="Identity documents" />
            {m.kyc.length === 0 ? (
              <p className="text-[12px] text-slate-500">No documents uploaded.</p>
            ) : (
              <ul className="space-y-4">
                {m.kyc.map((k) => (
                  <li key={k.id} className="space-y-2 text-[12px]">
                    <p className="flex flex-wrap items-center gap-2"><KycBadge kyc={k} /> <b>{k.documentName}</b> · {formatDate(k.createdAt)}{k.rejectionReason ? ` · Reason: ${k.rejectionReason}` : ""}</p>
                    <KycPhotos kyc={k} compact />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <SectionTitle eyebrow="History" title="Last transactions" />
              {m.transactions.length === 0 ? <p className="text-[12px] text-slate-500">No transactions.</p> : (
                <ul className="space-y-2" data-testid="member-transactions">
                  {m.transactions.map((t) => (
                    <li key={t.id} className={row}>
                      <span className="min-w-0"><b>{t.description}</b><span className="block text-slate-400">{formatDate(t.createdAt)} · {t.reference}</span></span>
                      <span className={`font-black ${t.direction === "in" ? "text-emerald-600" : "text-slate-800"}`}>{t.direction === "in" ? "+" : "−"}{formatMoney(t.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <SectionTitle eyebrow="Requests" title="Deposits, withdrawals, cards" />
              <ul className="space-y-2 text-[12px]">
                {m.deposits.map((d) => (
                  <li key={`d${d.id}`} className={row}><span>Deposit {d.method === "usdt_trc20" ? "USDT" : "BTC"} · {formatMoney(d.amountUsd)}<span className="block text-slate-400">{formatDate(d.createdAt)} · {d.reference}</span></span><Badge tone={STATUS_TONE[d.status] ?? "slate"}>{d.status.replace("_", " ")}</Badge></li>
                ))}
                {m.withdrawals.map((w) => (
                  <li key={`w${w.id}`} className={row}><span>Withdrawal · {formatMoney(w.amountUsd)}<span className="block text-slate-400">{formatDate(w.createdAt)} · {w.reference}</span></span><Badge tone={STATUS_TONE[w.status] ?? "slate"}>{w.status}</Badge></li>
                ))}
                {m.cardRequests.map((r) => (
                  <li key={`c${r.id}`} className={row}><span>{r.tierName} card request<span className="block text-slate-400">{formatDate(r.createdAt)} · {r.reference}</span></span><Badge tone={STATUS_TONE[r.status] ?? "slate"}>{r.status}</Badge></li>
                ))}
                {m.deposits.length + m.withdrawals.length + m.cardRequests.length === 0 && <li className="text-slate-500">No requests.</li>}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/** Admin → Members: search, member details, password reset. */
export function AdminMembersView({ notify }: { notify: (t: Toast) => void }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<{ total: number; totalMembers: number; members: MemberSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await admin({ action: "members", search: query, offset }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load members.");
    }
  }, [query, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setQuery(search.trim());
  }

  if (selected) return <Detail accountNumber={selected} onBack={() => { setSelected(null); void load(); }} notify={notify} />;

  return (
    <Card>
      <SectionTitle eyebrow="Members" title={`Members${data ? ` (${data.totalMembers})` : ""}`} />
      <form onSubmit={submit} className="mb-4 flex gap-2" role="search">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, email or account number"
            aria-label="Search members"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-base font-semibold focus:border-purple-400 focus:outline-none sm:text-[13px]"
          />
        </div>
        <button type="submit" className={`${button} h-11 shrink-0 bg-[#10152b] text-white`}>Search</button>
      </form>
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-600">{error}</p>}
      {!data && !error && <p className="flex items-center gap-2 text-[12px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {data && data.members.length === 0 && (
        <p className="rounded-2xl bg-slate-50 p-6 text-center text-[13px] text-slate-500" data-testid="members-empty">
          <Users className="mx-auto mb-2 h-6 w-6 text-slate-300" />No members found{query ? ` for “${query}”` : ""}.
        </p>
      )}
      {data && data.members.length > 0 && (
        <>
          {query && <p className="mb-2 text-[12px] text-slate-500">{data.total} result(s) for “{query}”</p>}
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100" data-testid="members-list">
            {data.members.map((m) => (
              <li key={m.accountNumber}>
                <button
                  onClick={() => setSelected(m.accountNumber)}
                  className="grid w-full gap-2 px-4 py-3 text-left text-[12px] transition hover:bg-purple-50/40 sm:grid-cols-[1.4fr_1fr_auto] sm:items-center"
                  data-testid="member-row"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-50 text-[#7F00FF]"><UserRound className="h-4 w-4" /></span>
                    <span className="min-w-0">
                      <span className="block truncate font-black text-[#10152b]">{m.name}{m.isAdmin ? " · admin" : ""}</span>
                      <span className="block truncate text-slate-500">{m.email}</span>
                      <span className="block font-mono text-slate-500">{formatAccountNumber(m.accountNumber)}</span>
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <CardTone card={m.card} />
                    <KycTone status={m.kycStatus} />
                    {m.mustChangePassword && <Badge tone="amber">Temporary password</Badge>}
                  </span>
                  <span className="text-right">
                    <span className="block font-black">{formatMoney(m.balance)}</span>
                    <span className="block text-slate-400">joined {formatDate(m.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {data.total > 50 && (
            <div className="mt-3 flex items-center justify-between text-[12px]">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))} className={`${button} h-9 border border-slate-200 bg-white`}>Previous</button>
              <span className="text-slate-500">{offset + 1}–{Math.min(offset + 50, data.total)} of {data.total}</span>
              <button disabled={offset + 50 >= data.total} onClick={() => setOffset(offset + 50)} className={`${button} h-9 border border-slate-200 bg-white`}>Next</button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
