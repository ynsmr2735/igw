import { cookies } from "next/headers";
import { rpc } from "@/lib/supabase";

export const SESSION_COOKIE = "igw_session";
/**
 * Cookie lifetime = the database's absolute session limit (30 days).
 * The database also ends a session after 7 days without activity and slides
 * that window forward on use, so active users stay signed in across reloads.
 */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/** Session tokens are 64 hex chars (32 random bytes from the database). */
export const SESSION_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  plan: string;
};

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? "";
  return SESSION_TOKEN_PATTERN.test(token) ? token : null;
}

/** Stores the token returned by igw_sign_up / igw_sign_in. Call from a Server Action. */
export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/** The signed-in user, verified against the sessions table, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = await getSessionToken();
  if (!token) return null;
  return rpc<SessionUser | null>("igw_me", { p_token: token });
}
