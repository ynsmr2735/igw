import { EXPECTED_SCHEMA } from "@/lib/payment-methods";
import { SetupError, isServiceKeyConfigured, rpc, serviceRpc } from "@/lib/supabase";

/**
 * Setup checks. The most common reason payments "do not work" after an update is
 * that the code and the database are on different versions (the SQL was not run,
 * or was run in another Supabase project), or that a server key is missing.
 * These checks turn that into a clear message instead of a misleading failure.
 */

const projectRef = () => {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  return url.match(/^https?:\/\/([^.]+)\.supabase\.co/i)?.[1] ?? url ?? "unknown";
};

let schemaOkUntil = 0;

/** Throws a SetupError when the database is not on the version this code needs. Cached for 60 s once OK. */
export async function assertSchema(): Promise<void> {
  if (Date.now() < schemaOkUntil) return;
  const health = await rpc<{ schema?: string }>("igw_health");
  const schema = health?.schema ?? "unknown";
  if (schema !== EXPECTED_SCHEMA) {
    throw new SetupError(
      `The database of Supabase project "${projectRef()}" is on version ${schema}, but this website needs ${EXPECTED_SCHEMA}. ` +
        "Run the whole supabase/schema.sql in the SQL Editor of THIS project, then reload.",
    );
  }
  schemaOkUntil = Date.now() + 60_000;
}

export type StatusItem = { key: string; label: string; ok: boolean; required: boolean; detail: string };

/** Status panel shown to admins: database version, server keys. */
export async function getSystemStatus(): Promise<StatusItem[]> {
  const items: StatusItem[] = [];
  let schema = "unknown";
  try {
    schema = (await rpc<{ schema?: string }>("igw_health"))?.schema ?? "unknown";
    items.push({
      key: "schema",
      label: "Database version",
      ok: schema === EXPECTED_SCHEMA,
      required: true,
      detail:
        schema === EXPECTED_SCHEMA
          ? `${schema} (project ${projectRef()})`
          : `Project ${projectRef()} is on ${schema}; this code needs ${EXPECTED_SCHEMA}. Run the whole supabase/schema.sql in the SQL Editor of this project.`,
    });
  } catch (error) {
    items.push({ key: "schema", label: "Database version", ok: false, required: true, detail: error instanceof Error ? error.message : "Supabase check failed" });
  }

  if (!isServiceKeyConfigured()) {
    items.push({
      key: "serviceKey",
      label: "SUPABASE_SERVICE_ROLE_KEY",
      ok: false,
      required: true,
      detail: "Not set. Needed so members can create deposit requests (server-side BTC price). Add it in Vercel → Settings → Environment Variables (no NEXT_PUBLIC_ prefix) and redeploy.",
    });
  } else {
    try {
      await serviceRpc("igw_service_ping");
      items.push({ key: "serviceKey", label: "SUPABASE_SERVICE_ROLE_KEY", ok: true, required: true, detail: "Set and accepted by Supabase." });
    } catch (error) {
      items.push({
        key: "serviceKey",
        label: "SUPABASE_SERVICE_ROLE_KEY",
        ok: false,
        required: true,
        detail: error instanceof Error ? error.message : "Rejected by Supabase.",
      });
    }
  }

  return items;
}
