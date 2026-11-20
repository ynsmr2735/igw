"use server";

import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/redirect";
import { clearSessionCookie, getSessionToken, setSessionCookie } from "@/lib/auth/session";
import { SetupError, rpc } from "@/lib/supabase";

export type AuthState = {
  error?: string;
  success?: string;
  /** Echoed back so the form keeps what the user typed after an error (never the password). */
  values?: { name?: string; email?: string };
};

type AuthResult = { ok: boolean; token?: string; error?: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const encoder = new TextEncoder();

function failure(prefix: string, error: unknown, values: AuthState["values"]): AuthState {
  console.error(`${prefix}:`, error);
  if (error instanceof SetupError) return { error: `${prefix}. Server setup error: ${error.message}`, values };
  return { error: `${prefix}. Please try again.`, values };
}

export async function signUpAction(
  _state: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const values = { name, email };

  // Same rules as igw_sign_up, checked here first for a quick answer.
  if (name.length < 2) return { error: "Please enter your full name.", values };
  if (name.length > 120) return { error: "Name is too long.", values };
  if (email.length > 180 || !EMAIL_PATTERN.test(email)) return { error: "Please enter a valid email address.", values };
  if (password.length < 8) return { error: "Password must be at least 8 characters long.", values };
  if (encoder.encode(password).length > 72) return { error: "Password is too long (max 72 characters).", values };

  try {
    const result = await rpc<AuthResult>("igw_sign_up", {
      p_full_name: name,
      p_email: email,
      p_password: password,
    });
    if (!result?.ok || !result.token) {
      return { error: result?.error ?? "Could not create your account.", values };
    }
    await setSessionCookie(result.token);
  } catch (error) {
    return failure("Could not create your account", error, values);
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
  const next = safeNextPath(formData.get("next"));
  const values = { email };

  if (!email || !password) return { error: "Email and password are required.", values };

  try {
    const result = await rpc<AuthResult>("igw_sign_in", { p_email: email, p_password: password });
    if (!result?.ok || !result.token) {
      return { error: result?.error ?? "Email or password is incorrect.", values };
    }
    await setSessionCookie(result.token);
  } catch (error) {
    return failure("Could not sign you in", error, values);
  }

  redirect(next);
}

export async function signOutAction(): Promise<void> {
  const token = await getSessionToken();
  if (token) {
    try {
      // Revoke the session in the database, not just in this browser.
      await rpc("igw_sign_out", { p_token: token });
    } catch (error) {
      console.error("Sign-out RPC failed:", error);
    }
  }
  await clearSessionCookie();
  redirect("/login");
}
