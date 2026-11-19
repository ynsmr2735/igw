import { db, isDatabaseConfigured } from "@/db";
import { getAuthSecret } from "@/lib/auth/token";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const authSecret = Boolean(getAuthSecret());

  if (!isDatabaseConfigured()) {
    return Response.json({ ok: false, database: "DATABASE_URL is not set", authSecret }, { status: 500 });
  }

  try {
    await db.execute(sql`select 1 from public.profiles limit 1`);
    return Response.json({ ok: authSecret, database: "ok", authSecret }, { status: authSecret ? 200 : 500 });
  } catch (error) {
    console.error("Health check failed:", error);
    return Response.json({ ok: false, database: "unreachable or schema missing", authSecret }, { status: 500 });
  }
}
