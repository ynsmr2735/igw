"use server";

import { redirect } from "next/navigation";
import { clearSessionCookie, getSessionToken, setSessionCookie } from "@/lib/auth/session";
import { SetupError, rpc } from "@/lib/supabase";

export type AuthState = {
  error?: string;
  success?: string;
};

type AuthResult = { ok: boolean; token?: string; error?: string };

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "/dashboard";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

function failure(prefix: string, error: unknown): AuthState {
  console.error(`${prefix}:`, error);
  if (error instanceof SetupError) return { error: `${prefix}. Server setup error: ${error.message}` };
  return { error: `${prefix}. Please try again.` };
}

export async function signUpAction(
  _state: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  // Quick checks here; the database function validates again.
  if (name.length < 2) return { error: "Please enter your full name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Please enter a valid email address." };
  if (password.length < 8) return { error: "Password must be at least 8 characters long." };

  try {
    const result = await rpc<AuthResult>("igw_sign_up", {
      p_full_name: name,
      p_email: email,
      p_password: password,
    });
    if (!result?.ok || !result.token) return { error: result?.error ?? "Could not create your account." };
    await setSessionCookie(result.token);
  } catch (error) {
    return failure("Could not create your account", error);
  }

  // No email confirmation: the new user goes straight to the dashboard.
  redirect("/dashboard");
}

export async function signInAction(
  _state: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) return { error: "Email and password are required." };

  try {
    const result = await rpc<AuthResult>("igw_sign_in", { p_email: email, p_password: password });
    if (!result?.ok || !result.token) return { error: result?.error ?? "Email or password is incorrect." };
    await setSessionCookie(result.token);
  } catch (error) {
    return failure("Could not sign you in", error);
  }

  redirect(next);
}

export async function signOutAction(): Promise<void> {
  const token = await getSessionToken();
  if (token) {
    try {
      await rpc("igw_sign_out", { p_token: token });
    } catch (error) {
      console.error("Sign-out RPC failed:", error);
    }
  }
  await clearSessionCookie();
  redirect("/login");
}
