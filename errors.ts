/**
 * Turns a pg / Drizzle error into a short, actionable reason.
 * Drizzle wraps the original pg error in `cause`, so walk the chain.
 */

type PgLike = { code?: string; message?: string; cause?: unknown };

function flatten(error: unknown): PgLike[] {
  const chain: PgLike[] = [];
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 5; depth += 1) {
    chain.push(current as PgLike);
    current = (current as PgLike).cause;
  }
  return chain;
}

export function pgErrorCode(error: unknown): string | undefined {
  return flatten(error).find((item) => item.code)?.code;
}

export function describeDbError(error: unknown): string | null {
  const chain = flatten(error);
  const code = chain.find((item) => item.code)?.code;
  const text = chain.map((item) => item.message ?? "").join(" | ");

  if (/DATABASE_URL is required/.test(text)) return "DATABASE_URL is not set on the server.";
  if (/AUTH_SECRET/.test(text)) return "AUTH_SECRET is missing or shorter than 32 characters.";
  if (code === "42P01") return "Database tables are missing. Run supabase/schema.sql in the Supabase SQL Editor.";
  if (code === "42703") return "Database schema is outdated (e.g. profiles.password_hash missing). Run the new supabase/schema.sql.";
  if (code === "23503") return "Old foreign key to auth.users still exists. Run the new supabase/schema.sql.";
  if (code === "23502") return "profiles.id has no default value. Run the new supabase/schema.sql.";
  if (code === "28P01" || /password authentication failed/i.test(text)) return "Database password in DATABASE_URL is wrong.";
  if (/Tenant or user not found/i.test(text)) return "DATABASE_URL user is wrong. For the pooler it must be postgres.<project-ref>.";
  if (code === "ENOTFOUND" || /getaddrinfo/i.test(text)) return "Database host in DATABASE_URL cannot be found.";
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || /timeout/i.test(text)) return "Cannot connect to the database. Check DATABASE_URL (use the pooler URL on Vercel).";
  if (/certificate|SSL|TLS/i.test(text)) return "Database SSL connection failed.";
  if (/Invalid URL/i.test(text)) return "DATABASE_URL is not a valid URL (special characters in the password must be URL-encoded).";
  return null;
}
