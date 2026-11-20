import { SetupError, isServiceKeyConfigured, isSupabaseConfigured, rpc } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Checks the Supabase URL/key, that supabase/schema.sql was run, and the server-only service key. */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return Response.json(
      { ok: false, detail: "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set" },
      { status: 500 },
    );
  }

  try {
    const result = await rpc<{ ok: boolean; schema: string }>("igw_health");
    const serviceKey = isServiceKeyConfigured();
    return Response.json({
      ok: true,
      supabase: "ok",
      schema: result?.schema ?? "unknown",
      // Needed for BTC deposits and admin approvals.
      serviceKey: serviceKey ? "configured" : "missing: set SUPABASE_SERVICE_ROLE_KEY",
    });
  } catch (error) {
    const detail = error instanceof SetupError ? error.message : "Supabase check failed";
    return Response.json({ ok: false, detail }, { status: 500 });
  }
}
