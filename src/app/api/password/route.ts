import { errorResponse, readJson } from "@/lib/api";
import { getSessionToken } from "@/lib/auth/session";
import { AuthError, rpc } from "@/lib/supabase";

/**
 * POST /api/password  { current, next }  -> change the signed-in member's password.
 * Also used for the required change after an admin reset (temporary password).
 * Other sessions of the member are ended; this one stays signed in.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const current = typeof body.current === "string" ? body.current : "";
  const next = typeof body.next === "string" ? body.next : "";
  if (!current) return Response.json({ error: "Enter your current password." }, { status: 400 });
  if (next.length < 8) return Response.json({ error: "The new password must be at least 8 characters long." }, { status: 400 });
  if (new TextEncoder().encode(next).length > 72) return Response.json({ error: "The new password is too long (max 72 characters)." }, { status: 400 });
  try {
    const token = await getSessionToken();
    if (!token) throw new AuthError();
    const result = await rpc<{ ok: boolean; error?: string }>("igw_change_password", { p_token: token, p_current: current, p_new: next });
    if (!result?.ok) return Response.json({ error: result?.error ?? "Could not change the password." }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Change password");
  }
}
