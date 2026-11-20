import { errorResponse, readJson, toAmount } from "@/lib/api";
import { ACCOUNT_NUMBER_HINT, isAccountNumber, normalizeAccountNumber } from "@/lib/format";
import { lookupRecipient, sendTransfer } from "@/lib/wallet";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Member-to-member transfers by account number (UK1234567 12345; old 8-digit numbers still work).
 *   { action: "lookup", accountNumber }                              -> masked recipient name
 *   { action: "send", accountNumber, amount, idempotencyKey, note }  -> atomic transfer
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof Response) return body;

  const accountNumber = normalizeAccountNumber(String(body.accountNumber ?? ""));
  if (!isAccountNumber(accountNumber)) {
    return Response.json({ error: ACCOUNT_NUMBER_HINT }, { status: 400 });
  }

  try {
    if (body.action === "lookup") {
      return Response.json({ ok: true, recipient: await lookupRecipient(accountNumber) });
    }
    if (body.action === "send") {
      const amount = toAmount(body.amount);
      if (amount === null) return Response.json({ error: "Enter an amount greater than zero (max. 2 decimals)." }, { status: 400 });
      const idempotencyKey = String(body.idempotencyKey ?? "");
      if (!UUID.test(idempotencyKey)) return Response.json({ error: "Missing request id. Please try again." }, { status: 400 });
      const result = await sendTransfer({
        accountNumber,
        amount,
        idempotencyKey,
        note: String(body.note ?? "").slice(0, 140),
      });
      return Response.json({ ok: true, transfer: result });
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return errorResponse(error, "Transfer");
  }
}
