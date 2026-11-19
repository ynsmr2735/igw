"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ArrowRight, Check, Eye, EyeOff, Loader2, LockKeyhole, Mail, User } from "lucide-react";
import {
  signInAction,
  signUpAction,
  type AuthState,
} from "@/app/auth/actions";
import { Brand } from "@/components/Brand";

const initialState: AuthState = {};

export function AuthForm({ mode, next }: { mode: "login" | "signup"; next: string }) {
  const isSignup = mode === "signup";
  const [state, formAction, pending] = useActionState(
    isSignup ? signUpAction : signInAction,
    initialState,
  );
  const [showPassword, setShowPassword] = useState(false);
  const [accepted, setAccepted] = useState(isSignup);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f7f7fb] text-[#10152b]">
      <div className="pointer-events-none absolute -left-32 -top-40 h-[520px] w-[520px] rounded-full bg-purple-300/40 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 h-[480px] w-[480px] rounded-full bg-cyan-300/40 blur-[120px]" />

      <div className="relative mx-auto grid min-h-screen max-w-[1400px] items-center gap-10 px-5 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:px-12">
        {/* Brand panel */}
        <div className="hidden lg:block">
          <Link href="/">
            <Brand />
          </Link>
          <div className="relative mt-14 max-w-lg">
            <span className="inline-flex items-center gap-2 rounded-full border border-purple-200 bg-white/80 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#7F00FF]">
              <LockKeyhole className="h-3.5 w-3.5" /> Secure by design
            </span>
            <h1 className="mt-6 text-[clamp(2.6rem,4.2vw,4.2rem)] font-black leading-[1.04] tracking-[-0.05em]">
              Your money,
              <br />
              <span className="igw-text-gradient">without borders.</span>
            </h1>
            <p className="mt-6 max-w-md text-[15px] leading-7 text-slate-600">
              One wallet for 30+ currencies, instant transfers and virtual cards.
              Built for the way the world moves today.
            </p>

            <div className="mt-10 space-y-3">
              {[
                "Multi-currency accounts in USD, EUR, GBP and TRY",
                "Instant transfers with live exchange rates",
                "Virtual and physical cards with full control",
              ].map((item) => (
                <div key={item} className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full igw-gradient text-white">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-[13px] font-semibold text-slate-700">{item}</span>
                </div>
              ))}
            </div>

            <div className="mt-12 flex items-center gap-4 rounded-2xl border border-white/80 bg-white/70 p-4 igw-glass">
              <span className="flex h-10 w-10 items-center justify-center rounded-full igw-gradient text-[11px] font-black text-white">DA</span>
              <p className="text-[12px] leading-5 text-slate-600">
                “I manage all my client payments from one dashboard. IGW made cross-border
                transfers simple.”
                <span className="mt-1 block font-bold text-[#10152b]">— Deniz A., freelancer</span>
              </p>
            </div>
          </div>
        </div>

        {/* Form panel */}
        <div className="relative mx-auto w-full max-w-[480px]">
          <div className="mb-7 lg:hidden">
            <Link href="/">
              <Brand />
            </Link>
          </div>

          <div className="rounded-[30px] border border-white bg-white/90 p-7 igw-shadow sm:p-9">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#7F00FF]">
                  {isSignup ? "Get started" : "Welcome back"}
                </p>
                <h2 className="mt-2 text-[26px] font-black tracking-tight">
                  {isSignup ? "Create your wallet" : "Sign in to IGW"}
                </h2>
                <p className="mt-1.5 text-[13px] text-slate-500">
                  {isSignup
                    ? "Set up your account in less than a minute."
                    : "Enter your details to access your dashboard."}
                </p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl igw-gradient text-white shadow-lg">
                <LockKeyhole className="h-5 w-5" />
              </span>
            </div>

            <form action={formAction} className="mt-6 space-y-4">
              <input type="hidden" name="next" value={next} />

              {isSignup && (
                <div>
                  <label htmlFor="name" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    Full name
                  </label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="name"
                      name="name"
                      autoComplete="name"
                      required
                      minLength={2}
                      placeholder="Deniz Arslan"
                      className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-[13px] font-semibold text-slate-800 transition focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="email" className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Email address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="you@example.com"
                    className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-[13px] font-semibold text-slate-800 transition focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                  />
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="password" className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    Password
                  </label>
                  {!isSignup && (
                    <span className="text-[10px] font-semibold text-[#7F00FF]">Forgot password?</span>
                  )}
                </div>
                <div className="relative">
                  <LockKeyhole className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={isSignup ? "new-password" : "current-password"}
                    required
                    minLength={8}
                    placeholder={isSignup ? "At least 8 characters" : "••••••••"}
                    className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-11 text-[13px] font-semibold text-slate-800 transition focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-[#7F00FF]"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {isSignup && (
                <button
                  type="button"
                  onClick={() => setAccepted((value) => !value)}
                  className="flex w-full items-start gap-2.5 text-left"
                >
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${accepted ? "igw-gradient border-transparent text-white" : "border-slate-300 bg-white"}`}>
                    {accepted && <Check className="h-3 w-3" />}
                  </span>
                  <span className="text-[11px] leading-5 text-slate-500">
                    I agree to the Terms of Service and Privacy Policy.
                  </span>
                </button>
              )}

              {state.error && (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-[12px] font-semibold text-rose-600">
                  {state.error}
                </p>
              )}
              {state.success && (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-[12px] font-semibold text-emerald-700">
                  {state.success}
                </p>
              )}

              <button
                type="submit"
                disabled={pending || (isSignup && !accepted)}
                className="igw-gradient flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[13px] font-bold text-white shadow-[0_16px_30px_-12px_rgba(127,0,255,0.9)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {pending
                  ? "Please wait..."
                  : isSignup
                    ? "Create account"
                    : "Sign in securely"}
                {!pending && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>

            <p className="mt-6 text-center text-[12px] font-medium text-slate-500">
              {isSignup ? "Already have an account? " : "New to Insta Global Wallet? "}
              <Link href={isSignup ? "/login" : "/signup"} className="font-black text-[#7F00FF] hover:underline">
                {isSignup ? "Sign in" : "Create an account"}
              </Link>
            </p>
          </div>

          <p className="mt-5 text-center text-[11px] text-slate-400">
            Protected by 256-bit encryption · © {new Date().getFullYear()} Insta Global Wallet
          </p>
        </div>
      </div>
    </main>
  );
}
