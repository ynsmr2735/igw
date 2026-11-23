import { AuthError, ForbiddenError, RpcError, SetupError, PasswordChangeRequiredError } from "@/lib/supabase";

/** Shared helpers for the JSON API routes. */

export type JsonBody = Record<string, unknown>;

/** Reads a JSON object body. Plain cross-site form posts cannot send application/json. */
export async function readJson(request: Request): Promise<JsonBody | Response> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as JsonBody;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
}

/** Positive integer id, or null. */
export function toId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** USD amount with at most 2 decimals, > 0, or null. */
export function toAmount(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  return amount > 0 ? amount : null;
}

/** Maps errors to HTTP responses without leaking internal details. */
export function errorResponse(error: unknown, context: string): Response {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: 401 });
  if (error instanceof ForbiddenError) return Response.json({ error: error.message }, { status: 403 });
  if (error instanceof PasswordChangeRequiredError) return Response.json({ error: error.message, mustChangePassword: true }, { status: 428 });
  if (error instanceof RpcError) return Response.json({ error: error.message }, { status: 400 });
  if (error instanceof SetupError) {
    console.error(`${context}:`, error.message);
    return Response.json({ error: error.message }, { status: 503 });
  }
  console.error(`${context} failed:`, error instanceof Error ? error.message : "unknown error");
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}
