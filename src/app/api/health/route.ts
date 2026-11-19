import { SetupError, isSupabaseConfigured, rpc } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Checks the Supabase URL, the anon key and that supabase/schema.sql was run. */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return Response.json(
      { ok: false, detail: "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set" },
      { status: 500 },
    );
  }

  try {
    const result = await rpc<{ ok: boolean; schema: string }>("igw_health");
    return Response.json({ ok: true, supabase: "ok", schema: result?.schema ?? "unknown" });
  } catch (error) {
    const detail = error instanceof SetupError ? error.message : "Supabase check failed";
    return Response.json({ ok: false, detail }, { status: 500 });
  }
}
