import { db, isDatabaseConfigured } from "@/db";
import { describeDbError } from "@/db/errors";
import { getAuthSecret } from "@/lib/auth/token";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Check = { ok: boolean; detail?: string };

/** Each check explains what is wrong with the sign-up setup, if anything. */
export async function GET() {
  const checks: Record<string, Check> = {
    authSecret: getAuthSecret()
      ? { ok: true }
      : { ok: false, detail: "AUTH_SECRET is missing or shorter than 32 characters" },
    databaseUrl: isDatabaseConfigured()
      ? { ok: true }
      : { ok: false, detail: "DATABASE_URL is not set" },
  };

  if (checks.databaseUrl.ok) {
    try {
      await db.execute(sql`select 1`);
      checks.connection = { ok: true };
    } catch (error) {
      console.error("Health check: connection failed", error);
      checks.connection = { ok: false, detail: describeDbError(error) ?? "Cannot connect to the database" };
    }
  }

  if (checks.connection?.ok) {
    try {
      const result = await db.execute(sql`
        select
          to_regclass('public.profiles') is not null as has_profiles,
          to_regclass('public.wallets') is not null as has_wallets,
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'profiles' and column_name = 'password_hash'
          ) as has_password_hash,
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'profiles' and column_name = 'id'
              and column_default is not null
          ) as has_id_default,
          exists (
            select 1 from pg_constraint c
            join pg_namespace n on n.oid = c.connamespace
            where c.contype = 'f' and n.nspname = 'public'
              and to_regclass('auth.users') is not null
              and c.confrelid = to_regclass('auth.users')
          ) as has_auth_users_fk
      `);
      const row = result.rows[0] as Record<string, boolean>;
      const problems: string[] = [];
      if (!row.has_profiles || !row.has_wallets) problems.push("tables missing");
      if (!row.has_password_hash) problems.push("profiles.password_hash missing");
      if (!row.has_id_default) problems.push("profiles.id has no default");
      if (row.has_auth_users_fk) problems.push("old foreign keys to auth.users still exist");
      checks.schema = problems.length
        ? { ok: false, detail: `${problems.join(", ")} — run the new supabase/schema.sql` }
        : { ok: true };
    } catch (error) {
      console.error("Health check: schema check failed", error);
      checks.schema = { ok: false, detail: describeDbError(error) ?? "Schema check failed" };
    }
  }

  const ok = Object.values(checks).every((check) => check.ok) && Boolean(checks.schema?.ok);
  return Response.json({ ok, checks }, { status: ok ? 200 : 500 });
}
