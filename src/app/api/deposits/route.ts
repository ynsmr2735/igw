import { errorResponse, readJson, toAmount, toId } from "@/lib/api";
import { normalizeTxid } from "@/lib/btc/address";
import { isPaymentMethod } from "@/lib/payment-methods";
import { cancelDeposit, createDeposit, submitDeposit } from "@/lib/wallet";

export const dynamic = "force-dynamic";

/**
 * Deposits (BTC or USDT TRC20).
 *   { action: "create", method, amountUsd }  -> payment request (exact crypto amount, address)
 *   { action: "submit", requestId, txid }    -> "I've paid": under review, balance unchanged
 *   { action: "cancel", requestId }          -> cancel an unpaid request
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof Response) return body;

  try {
    switch (body.action) {
      case "create": {
        const method = body.method ?? "btc";
        if (!isPaymentMethod(method)) return Response.json({ error: "Unknown payment method." }, { status: 400 });
        const amount = toAmount(body.amountUsd);
        if (amount === null) return Response.json({ error: "Enter a valid USD amount (max. 2 decimals)." }, { status: 400 });
        return Response.json({ ok: true, deposit: await createDeposit(method, amount) });
      }
      case "submit": {
        const id = toId(body.requestId);
        const txid = normalizeTxid(String(body.txid ?? ""));
        if (id === null) return Response.json({ error: "Invalid request id" }, { status: 400 });
        if (txid === null) {
          return Response.json({ error: "Enter a valid transaction ID (TXID / hash: 64 hexadecimal characters)." }, { status: 400 });
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
