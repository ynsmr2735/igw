"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { encodeQr, qrSvgPath } from "@/lib/qr";

/** Shared building blocks for the wallet and admin panels. */

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Fallback for browsers without the async clipboard API (older mobile Safari, WebViews).
    try {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({
  value,
  label = "Copy",
  className = "",
  onCopied,
  dark = false,
}: {
  value: string;
  label?: string;
  className?: string;
  onCopied?: (ok: boolean) => void;
  dark?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyText(value);
        setCopied(ok);
        onCopied?.(ok);
      }}
      aria-label={`${label}: ${value}`}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-bold transition ${
        dark
          ? "bg-white/15 text-white backdrop-blur hover:bg-white/25"
          : "border border-slate-200 bg-white text-slate-600 hover:border-purple-300 hover:text-[#7F00FF]"
      } ${className}`}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function QrCode({ value, size = 200, label }: { value: string; size?: number; label: string }) {
  const { path, size: modules } = useMemo(() => qrSvgPath(encodeQr(value)), [value]);
  // Whole pixels per module (min. 4) keep edges sharp on 1x screens, so cameras read it reliably.
  const pixels = modules * Math.max(4, Math.floor(size / modules));
  return (
    <svg
      role="img"
      aria-label={label}
      data-qr-value={value}
      width={pixels}
      height={pixels}
      viewBox={`0 0 ${modules} ${modules}`}
      shapeRendering="crispEdges"
      className="rounded-2xl bg-white"
    >
      <rect width={modules} height={modules} fill="#ffffff" />
      <path d={path} fill="#10152b" />
    </svg>
  );
}

const TONES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  purple: "bg-purple-50 text-[#7F00FF] ring-purple-200",
  red: "bg-rose-50 text-rose-600 ring-rose-200",
  slate: "bg-slate-100 text-slate-600 ring-slate-200",
};

export const STATUS_TONE: Record<string, keyof typeof TONES> = {
  awaiting_payment: "amber",
  reviewing: "purple",
  approved: "green",
  rejected: "red",
  expired: "slate",
  cancelled: "slate",
  pending: "purple",
  completed: "green",
  failed: "red",
};

export function Badge({ tone = "slate", children }: { tone?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-black ring-1 ${TONES[tone] ?? TONES.slate}`}>
      {children}
    </span>
  );
}

export function Card({ id, children, className = "" }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`scroll-mt-28 rounded-[26px] border border-slate-100 bg-white p-5 igw-shadow-soft sm:p-6 ${className}`}>
      {children}
    </section>
  );
}

export function SectionTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#7F00FF]">{eyebrow}</p>}
        <h2 className="mt-1 text-lg font-black tracking-tight sm:text-xl">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export type Toast = { type: "ok" | "error"; message: string } | null;

export function ToastView({ toast }: { toast: Toast }) {
  if (!toast) return null;
  return (
    <div
      role="status"
      className={`fixed bottom-5 left-1/2 z-[70] w-[min(92vw,440px)] -translate-x-1/2 rounded-2xl px-4 py-3.5 text-[13px] font-bold text-white shadow-2xl ${
        toast.type === "ok" ? "bg-[#10152b]" : "bg-rose-600"
      }`}
    >
      {toast.message}
    </div>
  );
}

/** Minutes:seconds left, rendered only after mount (no server/client mismatch). */
export function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (now === null) return <span>—</span>;
  const left = Math.max(0, new Date(until).getTime() - now);
  const minutes = Math.floor(left / 60000);
  const seconds = Math.floor((left % 60000) / 1000);
  return <span className="tabular-nums">{left === 0 ? "expired" : `${minutes}:${String(seconds).padStart(2, "0")}`}</span>;
}

/** POST JSON to our API; a 401 means the session ended, so go to sign-in. */
export async function postJson<T>(url: string, body: unknown, loginNext = "/dashboard"): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 401) {
    window.location.assign(`/login?next=${encodeURIComponent(loginNext)}`);
    throw new Error("Your session has ended. Please sign in again.");
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data;
}
