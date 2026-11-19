/**
 * Minimal Supabase RPC client (PostgREST over fetch), used on the server only.
 * Only the public URL + anon/publishable key are needed. The anon key can call
 * the igw_* database functions and nothing else (see supabase/schema.sql).
 */

/**
 * Accepts the project URL in the forms people usually paste:
 * "https://ref.supabase.co", ".../", ".../rest/v1", ".../rest/v1/".
 */
function normalizeUrl(raw: string): string {
  return raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\/+$/, "")
    .replace(/\/rest\/v1$/i, "")
    .replace(/\/+$/, "");
}

const SUPABASE_URL = normalizeUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
const SUPABASE_KEY = (
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  ""
).trim();

/** A configuration problem the site owner must fix (shown in the UI). */
export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupError";
  }
}

/** A normal error raised by a database function, e.g. "Insufficient balance". */
export class RpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcError";
  }
}

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!SUPABASE_URL) throw new SetupError("NEXT_PUBLIC_SUPABASE_URL is not set.");
  if (!/^https?:\/\/[^/]+$/i.test(SUPABASE_URL) || /supabase\.com/i.test(SUPABASE_URL)) {
    throw new SetupError(
      `NEXT_PUBLIC_SUPABASE_URL must look like https://<project-ref>.supabase.co (got "${SUPABASE_URL}").`,
    );
  }
  if (!SUPABASE_KEY) throw new SetupError("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set.");

  const headers: Record<string, string> = {
    apikey: SUPABASE_KEY,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  // Legacy anon keys are JWTs and go in Authorization too; new sb_publishable_ keys do not.
  if (SUPABASE_KEY.startsWith("eyJ")) headers.Authorization = `Bearer ${SUPABASE_KEY}`;

  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers,
      body: JSON.stringify(args),
      cache: "no-store",
    });
  } catch (error) {
    console.error(`Supabase RPC ${fn} network error:`, error);
    throw new SetupError("Cannot reach Supabase. Check NEXT_PUBLIC_SUPABASE_URL (https://<ref>.supabase.co).");
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (response.ok) return body as T;

  const info = (body ?? {}) as { code?: string; message?: string; hint?: string };
  console.error(`Supabase RPC ${fn} failed (${response.status}):`, body);

  if (response.status === 401 || /api key|jwt/i.test(info.message ?? "")) {
    throw new SetupError("NEXT_PUBLIC_SUPABASE_ANON_KEY is wrong or belongs to another project.");
  }
  if (info.code === "PGRST202") {
    throw new SetupError(
      `Database function ${fn} was not found in the project at ${SUPABASE_URL}. ` +
        "Run the whole supabase/schema.sql in the SQL Editor of this same project.",
    );
  }
  if (response.status === 404) {
    throw new SetupError(
      `Supabase returned 404 for ${SUPABASE_URL}/rest/v1/rpc/${fn}. ` +
        "Check NEXT_PUBLIC_SUPABASE_URL: it must be https://<project-ref>.supabase.co.",
    );
  }
  if (info.code === "42501") {
    throw new SetupError("Permission denied. Run the latest supabase/schema.sql in the Supabase SQL Editor.");
  }
  // Errors raised on purpose inside igw_wallet_action (P0001) carry a user-facing message.
  if (info.code === "P0001" && info.message) throw new RpcError(info.message);
  throw new Error(info.message ?? `Supabase request failed (${response.status})`);
}
