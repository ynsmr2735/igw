"use client";

import { useState, type FormEvent } from "react";
import { ArrowUpRight, CheckCircle2, CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { CARD_TIER_STYLE, type CardTier, type MemberCard, type WithdrawalCenter } from "@/lib/cards";
import { formatDate, formatMoney } from "@/lib/format";
import { Badge, Card, STATUS_TONE, SectionTitle, postJson, type Toast } from "@/components/wallet-ui";

export const WITHDRAWAL_STATUS_LABEL: Record<string, string> = {
  pending: "Pending review",
  approved: "Sent",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const inputClass =
  "h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base font-semibold text-slate-800 transition focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100 sm:text-[13px]";
const primaryButton =
  "igw-gradient inline-flex h-12 items-center justify-center gap-2 rounded-xl px-5 text-[13px] font-bold text-white shadow-[0_14px_30px_-12px_rgba(127,0,255,0.9)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";
const secondaryButton =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[12px] font-bold text-slate-700 transition hover:border-purple-300 hover:text-[#7F00FF] disabled:opacity-50";

const limitText = (limit: number | null) => (limit === null ? "Unlimited" : `${formatMoney(limit)} / 24 h`);

/** The member's card, drawn as a payment card. */
export function CardVisual({ card }: { card: MemberCard }) {
  const style = CARD_TIER_STYLE[card.tier];
  const active = card.status === "active";
  return (
    <div
      className={`relative aspect-[1.586] w-full max-w-[340px] overflow-hidden rounded-[22px] bg-gradient-to-br p-5 shadow-xl ${
        active ? `${style.gradient} ${style.text}` : "from-slate-300 to-slate-400 text-slate-700"
      }`}
      data-testid="member-card"
    >
      <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
      <div className="relative flex items-start justify-between">
        <p className="text-[11px] font-black uppercase tracking-[0.2em] opacity-80">Insta Global Wallet</p>
        <Badge tone={active ? "green" : "slate"}>{active ? "ACTIVE" : "INACTIVE"}</Badge>
      </div>
      <p className="relative mt-[14%] font-mono text-lg font-bold tracking-[0.2em]">•••• •••• •••• {card.cardNumber.slice(-4)}</p>
      <div className="relative mt-auto flex items-end justify-between pt-4">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] opacity-70">Card</p>
          <p className="text-[15px] font-black">{card.tierName}</p>
        </div>
        <div className="text-right">
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] opacity-70">Daily limit</p>
          <p className="text-[13px] font-black">{card.dailyLimit === null ? "Unlimited" : formatMoney(card.dailyLimit)}</p>
        </div>
      </div>
    </div>
  );
}

export default function WithdrawSection({
  center,
  balance,
  onChanged,
  notify,
}: {
  center: WithdrawalCenter;
  balance: number;
  onChanged: () => Promise<void>;
  notify: (toast: Toast) => void;
}) {
  const [tier, setTier] = useState<CardTier>("standard");
  const [note, setNote] = useState("");
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const card = center.card;
  const active = card?.status === "active";
  const pending = center.pendingCardRequest;

  async function run(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/withdrawals", body);
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

  async function requestCard(event: FormEvent) {
    event.preventDefault();
    if (await run({ action: "requestCard", tier, note }, "Your card request has been sent. Awaiting admin review.")) {
      setNote("");
      setShowUpgrade(false);
    }
  }

  async function submitWithdrawal() {
    if (await run({ action: "create", amountUsd: amount.trim(), btcAddress: address.trim() }, "Your withdrawal request has been received. Awaiting admin review.")) {
      setAmount("");
      setConfirming(false);
    }
  }

  const tierPicker = (
    <form onSubmit={requestCard} className="space-y-4" data-testid="card-request-form">
      <div role="radiogroup" aria-label="Card" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {center.tiers.map((t) => {
          const selected = t.tier === tier;
          const disabled = active && card?.tier === t.tier;
          return (
            <button
              key={t.tier}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => setTier(t.tier)}
              data-testid={`tier-${t.tier}`}
              className={`rounded-2xl border-2 p-4 text-left transition disabled:opacity-40 ${
                selected ? "border-[#7F00FF] bg-purple-50/60" : "border-slate-200 bg-white hover:border-purple-200"
              }`}
            >
              <span className={`block h-2 w-10 rounded-full bg-gradient-to-r ${CARD_TIER_STYLE[t.tier].gradient}`} />
              <span className="mt-3 block text-[14px] font-black">{t.name}</span>
              <span className="mt-0.5 block text-[12px] text-slate-500">Daily withdrawal limit</span>
              <span className="block text-[13px] font-black text-[#10152b]">{t.dailyLimit === null ? "Unlimited" : formatMoney(t.dailyLimit)}</span>
            </button>
          );
        })}
      </div>
      <div>
        <label htmlFor="card-note" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
          Note for the admin (optional)
        </label>
        <input id="card-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className={inputClass} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
          Request {CARD_TIER_STYLE[tier].name} card
        </button>
        <p className="text-[11px] text-slate-500">No fee. An admin reviews your request and activates the card.</p>
      </div>
    </form>
  );

  return (
    <Card id="withdraw">
      <SectionTitle eyebrow="Send to your wallet" title="Withdraw (Bitcoin)" action={<Badge tone="amber">Network: Bitcoin Mainnet</Badge>} />

      <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
        <div className="space-y-3">
          {card ? (
            <CardVisual card={card} />
          ) : (
            <div className="flex aspect-[1.586] w-full max-w-[340px] flex-col items-center justify-center rounded-[22px] border-2 border-dashed border-slate-200 bg-slate-50 p-5 text-center" data-testid="no-card">
              <CreditCard className="h-8 w-8 text-slate-400" />
              <p className="mt-2 text-[13px] font-black text-slate-600">No card yet</p>
              <p className="mt-1 text-[11px] text-slate-500">A card is required to withdraw.</p>
            </div>
          )}
          {active && (
            <dl className="grid max-w-[340px] grid-cols-3 gap-2 rounded-2xl bg-slate-50 p-3 text-[11px]" data-testid="limit-summary">
              <div><dt className="text-slate-500">Daily limit</dt><dd className="font-black">{center.dailyLimit === null ? "Unlimited" : formatMoney(center.dailyLimit)}</dd></div>
              <div><dt className="text-slate-500">Used (24 h)</dt><dd className="font-black">{formatMoney(center.usedLast24h)}</dd></div>
              <div><dt className="text-slate-500">Remaining</dt><dd className="font-black text-emerald-700" data-testid="remaining-today">{center.remainingToday === null ? "Unlimited" : formatMoney(center.remainingToday)}</dd></div>
            </dl>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          {card && !active && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[12px] text-rose-800" data-testid="card-inactive">
              Your {card.tierName} card has been deactivated{card.deactivationReason ? `: ${card.deactivationReason}` : ""}. You cannot withdraw until an admin activates a card again.
            </div>
          )}

          {pending && (
            <div className="rounded-2xl border border-purple-200 bg-purple-50/70 p-4 text-[12px]" data-testid="card-request-pending">
              <p className="text-[13px] font-black">Your {pending.tierName} card request is waiting for admin review</p>
              <p className="mt-1 text-slate-600">
                Ref. <span className="font-mono">{pending.reference}</span> · {formatDate(pending.createdAt)} · daily limit {limitText(pending.dailyLimit)}
              </p>
              <button onClick={() => run({ action: "cancelCardRequest", id: pending.id }, "Card request cancelled.")} disabled={busy} className={`${secondaryButton} mt-3`}>
                Cancel request
              </button>
            </div>
          )}

          {!active && !pending && (
            <>
              {center.lastCardRequest?.status === "rejected" && (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-[12px] text-rose-700" data-testid="card-request-rejected">
                  Your last card request ({center.lastCardRequest.tierName}) was rejected. Reason: {center.lastCardRequest.rejectionReason}
                </p>
              )}
              <div>
                <p className="mb-3 text-[13px] font-black">Choose a card to request</p>
                {tierPicker}
              </div>
            </>
          )}

          {active && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-[1.6fr_1fr]">
                <div>
                  <label htmlFor="withdraw-address" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    Your Bitcoin (BTC) address
                  </label>
                  <input
                    id="withdraw-address"
                    value={address}
                    onChange={(e) => { setAddress(e.target.value.trim()); setConfirming(false); }}
                    placeholder="bc1…, 1… or 3…"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div>
                  <label htmlFor="withdraw-amount" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    Amount (USD)
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[13px] font-bold text-slate-400">$</span>
                    <input
                      id="withdraw-amount"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => { setAmount(e.target.value.replace(",", ".")); setConfirming(false); }}
                      className={`${inputClass} pl-8`}
                    />
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                Available balance {formatMoney(balance)} · minimum {formatMoney(center.minUsd)} · remaining today{" "}
                {center.remainingToday === null ? "unlimited" : formatMoney(center.remainingToday)}. Only Bitcoin mainnet addresses; the amount is reserved
                from your balance until an admin sends it (or returned if the request is rejected).
              </p>
              {!confirming ? (
                <button onClick={() => { setError(null); setConfirming(true); }} disabled={busy || !address || !(Number(amount) > 0)} className={primaryButton}>
                  <ArrowUpRight className="h-4 w-4" /> Request withdrawal
                </button>
              ) : (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[12px] text-amber-900" data-testid="withdraw-confirm">
                  <p className="text-[13px] font-black">Withdraw {formatMoney(Number(amount))} to this Bitcoin address?</p>
                  <p className="mt-1 break-all font-mono">{address}</p>
                  <p className="mt-1">Check the address carefully: Bitcoin payments cannot be reversed.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={submitWithdrawal} disabled={busy} className={primaryButton}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Confirm withdrawal
                    </button>
                    <button onClick={() => setConfirming(false)} disabled={busy} className={secondaryButton}>Cancel</button>
                  </div>
                </div>
              )}
              {!pending && (
                <div>
                  <button onClick={() => setShowUpgrade((v) => !v)} className="text-[12px] font-bold text-[#7F00FF] hover:underline">
                    {showUpgrade ? "Hide" : "Request a different card (higher limit)"}
                  </button>
                  {showUpgrade && <div className="mt-3">{tierPicker}</div>}
                </div>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-[12px] font-semibold text-rose-600">
              {error}
            </p>
          )}
        </div>
      </div>

      {center.withdrawals.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Withdrawal history</p>
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100" data-testid="withdrawal-history">
            {center.withdrawals.map((wd) => (
              <li key={wd.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[12px]" data-reference={wd.reference}>
                <span className="font-mono text-slate-500">{wd.reference}</span>
                <span className="font-bold">{formatMoney(wd.amountUsd)}</span>
                <span className="font-mono text-slate-500">to {wd.btcAddress.slice(0, 8)}…{wd.btcAddress.slice(-6)}</span>
                <span className="text-slate-400">{formatDate(wd.createdAt)}</span>
                {wd.txid && (
                  <a href={`https://mempool.space/tx/${wd.txid}`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-mono text-[#7F00FF] hover:underline">
                    TXID {wd.txid.slice(0, 10)}… <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <span className="ml-auto flex items-center gap-2">
                  {wd.status === "pending" && (
                    <button onClick={() => run({ action: "cancel", id: wd.id }, "Withdrawal cancelled. The amount is back in your balance.")} disabled={busy} className="rounded-lg border border-slate-200 px-2 py-1 font-bold text-slate-600 hover:text-rose-600">
                      Cancel
                    </button>
                  )}
                  <Badge tone={STATUS_TONE[wd.status]}>{WITHDRAWAL_STATUS_LABEL[wd.status]}</Badge>
                </span>
                {wd.rejectionReason && <p className="w-full text-rose-600">Reason: {wd.rejectionReason}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
