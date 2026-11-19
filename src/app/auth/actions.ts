"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { describeDbError, pgErrorCode } from "@/db/errors";
import { profiles } from "@/db/schema";
import { getDummyHash, hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";
import { getAuthSecret } from "@/lib/auth/token";
import { provisionStarterData } from "@/lib/wallet";

export type AuthState = {
  error?: string;
  success?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "/dashboard";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

/** True only when the unique violation is on profiles.email. */
function isEmailTaken(error: unknown): boolean {
  if (pgErrorCode(error) !== "23505") return false;
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 5; depth += 1) {
    const constraint = (current as { constraint?: string }).constraint;
    if (constraint) return constraint.includes("email");
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function signUpAction(
  _state: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (name.length < 2) return { error: "Please enter your full name." };
  if (!EMAIL_PATTERN.test(email) || email.length > 180) return { error: "Please enter a valid email address." };
  if (password.length < 8) return { error: "Password must be at least 8 characters long." };
  if (password.length > 256) return { error: "Password is too long." };

  // Check config before writing anything, so a missing secret cannot leave
  // behind an account the user can't sign in to.
  if (!getAuthSecret()) {
    console.error("Sign-up blocked: AUTH_SECRET is missing or shorter than 32 characters");
    return { error: "Server setup error: AUTH_SECRET is missing or shorter than 32 characters." };
  }

  let userId: string;
  try {
    const [existing] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, email))
      .limit(1);
    if (existing) return { error: "An account with this email already exists. Please sign in." };

    const passwordHash = await hashPassword(password);

    userId = await db.transaction(async (tx) => {
      const [profile] = await tx
        .insert(profiles)
        .values({ fullName: name, email, passwordHash })
        .returning({ id: profiles.id });
      await provisionStarterData(tx, profile.id);
      return profile.id;
    });

    await createSession(userId);
  } catch (error) {
    if (isEmailTaken(error)) {
      return { error: "An account with this email already exists. Please sign in." };
    }
    console.error("Sign-up failed:", error);
    const reason = describeDbError(error);
    return {
      error: reason
        ? `Could not create your account. Server setup error: ${reason}`
        : "Could not create your account. Please try again.",
    };
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
    const [account] = await db
      .select({ id: profiles.id, passwordHash: profiles.passwordHash })
      .from(profiles)
      .where(eq(profiles.email, email))
      .limit(1);

    // Hash even when the email is unknown so response time does not reveal it.
    const valid = await verifyPassword(password, account?.passwordHash ?? (await getDummyHash()));
    if (!account || !account.passwordHash || !valid) {
      return { error: "Email or password is incorrect." };
    }

    await createSession(account.id);
  } catch (error) {
    console.error("Sign-in failed:", error);
    const reason = describeDbError(error);
    return {
      error: reason
        ? `Could not sign you in. Server setup error: ${reason}`
        : "Could not sign you in. Please try again.",
    };
  }

  redirect(next);
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
