import { errorResponse, readJson, toId } from "@/lib/api";
import { markNotificationsRead } from "@/lib/wallet";

export const dynamic = "force-dynamic";

/** { action: "read", ids?: number[] } -> marks the user's own notifications as read (all when ids is omitted). */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (body.action !== "read") return Response.json({ error: "Unknown action" }, { status: 400 });

  let ids: number[] | null = null;
  if (body.ids !== undefined) {
    if (!Array.isArray(body.ids) || body.ids.length > 200) return Response.json({ error: "Invalid ids" }, { status: 400 });
    ids = body.ids.map(toId).filter((id): id is number => id !== null);
  }
  try {
    return Response.json({ ok: true, updated: await markNotificationsRead(ids) });
  } catch (error) {
    return errorResponse(error, "Notifications");
  }
}
