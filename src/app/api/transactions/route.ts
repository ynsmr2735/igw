import { executeAction, type ActionPayload } from "@/lib/wallet";

export const dynamic = "force-dynamic";

type Body = Record<string, unknown>;

export async function POST(request: Request) {
  try {
    const raw = (await request.json()) as Body;
    const action = String(raw.action ?? "");
    const allowed = ["send", "topup", "withdraw", "exchange", "toggleCard"];
    if (!allowed.includes(action)) {
      return Response.json({ error: "Unknown action" }, { status: 400 });
    }

    const amount = Number(raw.amount ?? 0);
    if (action !== "toggleCard" && (!Number.isFinite(amount) || amount <= 0)) {
      return Response.json({ error: "Enter a valid amount" }, { status: 400 });
    }

    const payload: ActionPayload = {
      action,
      amount,
      note: String(raw.note ?? ""),
      walletId: raw.walletId ? Number(raw.walletId) : undefined,
      targetWalletId: raw.targetWalletId ? Number(raw.targetWalletId) : undefined,
      recipientId: raw.recipientId ? Number(raw.recipientId) : undefined,
      cardId: raw.cardId ? Number(raw.cardId) : undefined,
      method: String(raw.method ?? ""),
    };

    const result = await executeAction(payload);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transaction failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
