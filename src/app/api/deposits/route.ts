import { errorResponse, readJson, toAmount, toId } from "@/lib/api";
import { normalizeTxid } from "@/lib/btc/address";
import { cancelDeposit, createDeposit, submitDeposit } from "@/lib/wallet";

export const dynamic = "force-dynamic";

/**
 * BTC deposits.
 *   { action: "create", amountUsd }          -> payment quote (exact BTC amount, address)
 *   { action: "submit", requestId, txid }    -> "I've paid": under review, balance unchanged
 *   { action: "cancel", requestId }          -> cancel an unpaid request
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof Response) return body;

  try {
    switch (body.action) {
      case "create": {
        const amount = toAmount(body.amountUsd);
        if (amount === null) return Response.json({ error: "Enter a valid USD amount (max. 2 decimals)." }, { status: 400 });
        return Response.json({ ok: true, deposit: await createDeposit(amount) });
      }
      case "submit": {
        const id = toId(body.requestId);
        const txid = normalizeTxid(String(body.txid ?? ""));
        if (id === null) return Response.json({ error: "Invalid request id" }, { status: 400 });
        if (txid === null) {
          return Response.json({ error: "Enter a valid Bitcoin transaction ID (64 hexadecimal characters)." }, { status: 400 });
        }
        return Response.json({ ok: true, deposit: await submitDeposit(id, txid) });
      }
      case "cancel": {
        const id = toId(body.requestId);
        if (id === null) return Response.json({ error: "Invalid request id" }, { status: 400 });
        return Response.json({ ok: true, deposit: await cancelDeposit(id) });
      }
      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return errorResponse(error, "Deposit");
  }
}
