import { errorResponse, readJson, toAmount, toId } from "@/lib/api";
import { isCardTier } from "@/lib/cards";
import { cancelCardRequest, cancelWithdrawal, createWithdrawal, requestCard } from "@/lib/withdrawals";

export const dynamic = "force-dynamic";

/**
 * Cards and crypto withdrawals (member).
 *   { action: "requestCard", tier, note }        -> card request for the admin (no fee)
 *   { action: "cancelCardRequest", id }
 *   { action: "create", amountUsd, btcAddress }  -> withdrawal request (needs an active card)
 *   { action: "cancel", id }                     -> cancel own pending withdrawal (amount returned)
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof Response) return body;

  try {
    switch (body.action) {
      case "requestCard": {
        if (!isCardTier(body.tier)) return Response.json({ error: "Choose a card: Standard, Gold, Premium or Merchant." }, { status: 400 });
        return Response.json({ ok: true, request: await requestCard(body.tier, String(body.note ?? "")) });
      }
      case "cancelCardRequest": {
        const id = toId(body.id);
        if (id === null) return Response.json({ error: "Invalid id" }, { status: 400 });
        return Response.json({ ok: true, request: await cancelCardRequest(id) });
      }
      case "create": {
        const amount = toAmount(body.amountUsd);
        if (amount === null) return Response.json({ error: "Enter a valid USD amount (max. 2 decimals)." }, { status: 400 });
        const address = String(body.btcAddress ?? "").trim();
        if (!address) return Response.json({ error: "Enter your Bitcoin address." }, { status: 400 });
        return Response.json({ ok: true, withdrawal: await createWithdrawal(amount, address) });
      }
      case "cancel": {
        const id = toId(body.id);
        if (id === null) return Response.json({ error: "Invalid id" }, { status: 400 });
        return Response.json({ ok: true, withdrawal: await cancelWithdrawal(id) });
      }
      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return errorResponse(error, "Withdrawal");
  }
}
