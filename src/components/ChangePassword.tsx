"use client";

import { useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/Brand";

const inputClass =
  "h-12 w-full rounded-xl border border-slate-200 bg-white px-3.5 pr-11 text-base font-semibold text-slate-800 transition focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100 sm:text-[14px]";

/** Current + new password (twice). Used in the profile and on the required-change screen. */
export function ChangePasswordForm({ forced = false, onDone }: { forced?: boolean; onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (next.length < 8) return setError("The new password must be at least 8 characters long.");
    if (next !== repeat) return setError("The two new passwords do not match.");
    if (next === current) return setError("Choose a new password that is different from the current one.");
    setBusy(true);
    try {
      const response = await fetch("/api/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      if (response.status === 401) {
        window.location.assign("/login?next=/dashboard");
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not change the password.");
      setCurrent("");
      setNext("");
      setRepeat("");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, auto: string) => (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</label>
      <div className="relative">
        <input id={id} type={show ? "text" : "password"} autoComplete={auto} value={value} onChange={(e) => set(e.target.value)} className={inputClass} required />
        {id === "pw-current" && (
          <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide passwords" : "Show passwords"} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="change-password-form">
      {field("pw-current", forced ? "Temporary password" : "Current password", current, setCurrent, "current-password")}
      {field("pw-new", "New password (min. 8 characters)", next, setNext, "new-password")}
      {field("pw-repeat", "Repeat new password", repeat, setRepeat, "new-password")}
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-600">{error}</p>}
      <button type="submit" disabled={busy} className="igw-gradient inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-[14px] font-black text-white disabled:opacity-60 sm:w-auto">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} {forced ? "Set new password" : "Change password"}
      </button>
    </form>
  );
}

/** Shown instead of the dashboard after an admin password reset, until a new password is set. */
export function ForcedPasswordChange({ name, signOut }: { name: string; signOut: () => Promise<void> }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f5fb] px-4 py-10">
      <div className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-xl sm:p-8" data-testid="forced-password-change">
        <Brand />
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            Hello {name}. Your password was reset by our support team. For your security, choose a new password now — only you will know it.
          </p>
        </div>
        <div className="mt-6">
          <ChangePasswordForm forced onDone={() => window.location.assign("/dashboard")} />
        </div>
        <form action={signOut} className="mt-6 border-t border-slate-100 pt-4">
          <button type="submit" className="inline-flex items-center gap-2 text-[12px] font-bold text-slate-500 hover:text-slate-800">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
