import { executeAction, type ActionPayload } from "@/lib/wallet";
import { AuthError, RpcError, SetupError } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Body = Record<string, unknown>;

const ALLOWED_ACTIONS = ["send", "topup", "withdraw", "exchange", "toggleCard"];
const MAX_AMOUNT = 1_000_000_000;

/** Positive integer id, or undefined. Rejects "1abc", 1.5, -3, NaN. */
function toId(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : Number.NaN;
}

export async function POST(request: Request) {
  // Only JSON bodies: plain cross-site <form> posts cannot send this content type.
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let raw: Body;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    raw = parsed as Body;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const action = String(raw.action ?? "");
  if (!ALLOWED_ACTIONS.includes(action)) {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  const amount = Number(raw.amount ?? 0);
  if (action !== "toggleCard" && (!Number.isFinite(amount) || amount <= 0)) {
    return Response.json({ error: "Enter a valid amount" }, { status: 400 });
  }
  if (amount > MAX_AMOUNT) {
    return Response.json({ error: "Amount is too large" }, { status: 400 });
  }

  const ids = {
    walletId: toId(raw.walletId),
    targetWalletId: toId(raw.targetWalletId),
    recipientId: toId(raw.recipientId),
    cardId: toId(raw.cardId),
  };
  if (Object.values(ids).some((id) => Number.isNaN(id))) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }

  const payload: ActionPayload = {
    action,
    amount,
    note: String(raw.note ?? "").slice(0, 200),
    method: String(raw.method ?? "").slice(0, 80),
    ...ids,
  };

  try {
    const result = await executeAction(payload);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof RpcError) {
      // Business rule from the database, e.g. "Insufficient balance".
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SetupError) {
      return Response.json({ error: "Service is temporarily unavailable" }, { status: 503 });
    }
    console.error("Transaction failed:", error);
    return Response.json({ error: "Transaction failed" }, { status: 500 });
  }
}
