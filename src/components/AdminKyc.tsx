"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck, X, XCircle } from "lucide-react";
import { KYC_STATUS_LABEL, kycImageUrl, type AdminKycSubmission } from "@/lib/kyc";
import { formatAccountNumber, formatDate } from "@/lib/format";
import { Badge, Card, SectionTitle, postJson, type Toast } from "@/components/wallet-ui";

const button = "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-[12px] font-black transition disabled:opacity-50";

async function admin<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  return postJson<T>("/api/admin", body, "/admin");
}

export function KycBadge({ kyc }: { kyc: AdminKycSubmission | null }) {
  const status = kyc?.status ?? "none";
  const tone = status === "approved" ? "green" : status === "pending" ? "amber" : status === "rejected" ? "red" : "slate";
  return <Badge tone={tone}>ID: {KYC_STATUS_LABEL[status]}</Badge>;
}

/** Full-size view of one identity photo (click to close). */
function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={alt} className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4" onClick={onClose} data-testid="kyc-lightbox">
      <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-800">
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="max-h-full max-w-full rounded-xl object-contain" onClick={(e: { stopPropagation: () => void }) => e.stopPropagation()} />
    </div>
  );
}

/** Front + back thumbnails (loaded through the admin-only route). */
export function KycPhotos({ kyc, compact = false }: { kyc: AdminKycSubmission; compact?: boolean }) {
  const [open, setOpen] = useState<"front" | "back" | null>(null);
  const label = (side: "front" | "back") => `${kyc.documentName} ${side} – ${kyc.userName}`;
  return (
    <div className={`grid grid-cols-2 gap-2 ${compact ? "max-w-[320px]" : "max-w-[460px]"}`} data-testid="kyc-photos">
      {(["front", "back"] as const).map((side) => (
        <button key={side} type="button" onClick={() => setOpen(side)} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100 text-left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={kycImageUrl(kyc.id, side)} alt={label(side)} loading="lazy" className="aspect-[1.586] w-full object-cover transition group-hover:opacity-90" data-testid={`kyc-img-${side}`} />
          <span className="absolute bottom-1 left-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">{side}</span>
        </button>
      ))}
      {open && <Lightbox src={kycImageUrl(kyc.id, open)} alt={label(open)} onClose={() => setOpen(null)} />}
    </div>
  );
}

function KycRow({ k, onChanged, notify }: { k: AdminKycSubmission; onChanged: () => Promise<void>; notify: (t: Toast) => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = k.status === "pending";

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      await admin({ action: "decideKyc", id: k.id, approve, reason: approve ? null : reason });
      notify({ type: "ok", message: approve ? `Identity of ${k.userName} verified.` : `Identity documents of ${k.userName} rejected.` });
      setRejecting(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`rounded-2xl border p-4 text-[12px] ${pending ? "border-amber-300 bg-amber-50/50" : "border-slate-100 bg-white"}`} data-testid="kyc-row" data-reference={k.reference}>
      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-black">{k.userName}</p>
            <KycBadge kyc={k} />
          </div>
          <p className="font-mono text-slate-500">{formatAccountNumber(k.accountNumber)}</p>
          <p className="truncate text-slate-400">{k.email}</p>
          <p className="text-slate-600"><b>{k.documentName}</b> · ref. <span className="font-mono">{k.reference}</span> · {formatDate(k.createdAt)}</p>
          {k.pendingCardRequest && (
            <p className="text-[#7F00FF]">Waiting card request: {k.pendingCardRequest.tierName ?? k.pendingCardRequest.tier} ({k.pendingCardRequest.reference})</p>
          )}
          {k.reviewedAt && <p className="text-slate-400">Reviewed {formatDate(k.reviewedAt)}{k.reviewedBy ? ` by ${k.reviewedBy}` : ""}</p>}
          {k.rejectionReason && <p className="text-rose-600">Reason: {k.rejectionReason}</p>}
        </div>
        <KycPhotos kyc={k} />
      </div>
      {pending && !rejecting && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => decide(true)} disabled={busy} className={`${button} bg-emerald-600 text-white hover:bg-emerald-700`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} VERIFY IDENTITY
          </button>
          <button onClick={() => setRejecting(true)} disabled={busy} className={`${button} bg-rose-600 text-white hover:bg-rose-700`}>
            <XCircle className="h-4 w-4" /> REJECT DOCUMENTS
          </button>
        </div>
      )}
      {pending && rejecting && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
          <label htmlFor={`reason-k-${k.id}`} className="font-bold text-rose-900">Reason (sent to the member), e.g. “Photo is blurry” or “Name does not match”</label>
          <textarea id={`reason-k-${k.id}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500}
            className="mt-1.5 w-full rounded-xl border border-rose-200 bg-white p-2.5 text-base focus:outline-none sm:text-[13px]" />
          {k.pendingCardRequest && <p className="mt-1 text-rose-800">The waiting card request is closed too; the member can send new documents with a new request.</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => decide(false)} disabled={busy || reason.trim().length < 3} className={`${button} bg-rose-600 text-white`}>Confirm rejection</button>
            <button onClick={() => setRejecting(false)} disabled={busy} className={`${button} border border-slate-200 bg-white text-slate-700`}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 rounded-xl border border-rose-200 bg-white px-3 py-2 font-semibold text-rose-600">{error}</p>}
    </li>
  );
}

/** Admin → Identity (KYC): documents uploaded by members. */
export function AdminKycView({ notify, onCountsChanged }: { notify: (t: Toast) => void; onCountsChanged: () => Promise<void> }) {
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [rows, setRows] = useState<AdminKycSubmission[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await admin<{ submissions: AdminKycSubmission[] }>({ action: "kyc", status: filter === "pending" ? "pending" : null });
      setRows(r.submissions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load identity documents.");
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = async () => {
    await load();
    await onCountsChanged();
  };

  return (
    <Card>
      <SectionTitle
        eyebrow="Members"
        title="Identity verification (KYC)"
        action={
          <div className="flex items-center gap-2">
            {(["pending", "all"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${filter === f ? "bg-[#10152b] text-white" : "bg-slate-100 text-slate-600"}`}>
                {f === "pending" ? "Waiting" : "All"}
              </button>
            ))}
            <button onClick={() => void load()} aria-label="Refresh" className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600"><RefreshCw className="h-3.5 w-3.5" /></button>
          </div>
        }
      />
      <p className="mb-4 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-[12px] text-slate-600">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#7F00FF]" />
        Check that the photos are sharp, both sides belong to the same document and the name matches the member. Photos are private: only admins can open them here.
      </p>
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-600">{error}</p>}
      {!rows && !error && <p className="flex items-center gap-2 text-[12px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {rows && rows.length === 0 && <p className="rounded-2xl bg-slate-50 p-6 text-center text-[13px] text-slate-500" data-testid="kyc-empty">No identity documents {filter === "pending" ? "waiting for review" : "yet"}.</p>}
      {rows && rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((k) => <KycRow key={k.id} k={k} onChanged={changed} notify={notify} />)}
        </ul>
      )}
    </Card>
  );
}
