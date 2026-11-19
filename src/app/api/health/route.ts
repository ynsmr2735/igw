import { db, isDatabaseConfigured } from "@/db";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const mode = isSupabaseConfigured() ? "supabase" : "demo";

  // Supabase mode does not need the local PostgreSQL database.
  if (!isDatabaseConfigured()) {
    return mode === "supabase"
      ? Response.json({ ok: true, mode, database: "not configured" })
      : Response.json({ ok: false, mode, error: "DATABASE_URL is not set" }, { status: 500 });
  }

  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, mode, database: "ok" });
  } catch {
    return Response.json({ ok: false, mode, database: "unreachable" }, { status: 500 });
  }
}
