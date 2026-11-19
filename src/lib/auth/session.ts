import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  getAuthSecret,
  signSession,
  verifySession,
} from "./token";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  plan: string;
};

function requireSecret(): string {
  const secret = getAuthSecret();
  if (!secret) {
    throw new Error("AUTH_SECRET is missing or shorter than 32 characters");
  }
  return secret;
}

/** Signs the user in by setting the session cookie. Call from a Server Action. */
export async function createSession(userId: string): Promise<void> {
  const token = await signSession(userId, requireSecret());
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/** The signed-in user, or null. Verifies the signature and that the profile still exists. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE)?.value, getAuthSecret());
  if (!session) return null;

  const [row] = await db
    .select({
      id: profiles.id,
      name: profiles.fullName,
      email: profiles.email,
      plan: profiles.plan,
    })
    .from(profiles)
    .where(eq(profiles.id, session.sub))
    .limit(1);

  return row ?? null;
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("You must be signed in");
  return user;
}
