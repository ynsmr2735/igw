import { errorResponse, readJson, toAmount, toId } from "@/lib/api";
import {
  approveDeposit,
  getAdminOverview,
  getDeposit,
  listAllTransactions,
  listDeposits,
  markAdminNotificationsRead,
  pollAdmin,
  rejectDeposit,
  setDepositAddress,
  setMethodEnabled,
} from "@/lib/admin";
import { isPaymentMethod } from "@/lib/payment-methods";
import { getSystemStatus } from "@/lib/system";
import { requireAdminSession } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * Admin API. Every action is authorised in the database (admin_roles) through
 * the session cookie; a member gets 403, a visitor 401.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  if (body instanceof Response) return body;

  try {
    switch (body.action) {
      case "poll":
        return Response.json({ ok: true, poll: await pollAdmin() });
      case "status":
        await requireAdminSession();
        return Response.json({ ok: true, status: await getSystemStatus() });
      case "overview":
        return Response.json({ ok: true, overview: await getAdminOverview() });
      case "deposits":
        return Response.json({ ok: true, deposits: await listDeposits(typeof body.status === "string" ? body.status : null) });
      case "deposit": {
        const id = toId(body.id);
        if (id === null) return Response.json({ error: "Invalid id" }, { status: 400 });
        return Response.json({ ok: true, deposit: await getDeposit(id) });
      }
      case "approve": {
        const id = toId(body.id);
        if (id === null) return Response.json({ error: "Invalid id" }, { status: 400 });
        let credit: number | null = null;
        if (body.creditUsd !== undefined && body.creditUsd !== null && body.creditUsd !== "") {
          credit = toAmount(body.creditUsd);
          if (credit === null) return Response.json({ error: "Enter a valid amount to credit (max. 2 decimals)." }, { status: 400 });
        }
        return Response.json({ ok: true, ...(await approveDeposit(id, credit)) });
      }
      case "reject": {
        const id = toId(body.id);
        if (id === null) return Response.json({ error: "Invalid id" }, { status: 400 });
        return Response.json({ ok: true, deposit: await rejectDeposit(id, String(body.reason ?? "")) });
      }
      case "transactions":
        return Response.json({ ok: true, transactions: await listAllTransactions() });
      case "setDepositAddress": {
        if (!isPaymentMethod(body.method)) return Response.json({ error: "Unknown payment method" }, { status: 400 });
        const address = await setDepositAddress(body.method, String(body.address ?? ""));
        return Response.json({ ok: true, method: body.method, address });
      }
      case "setMethodEnabled": {
        if (!isPaymentMethod(body.method)) return Response.json({ error: "Unknown payment method" }, { status: 400 });
        if (typeof body.enabled !== "boolean") return Response.json({ error: "enabled must be true or false" }, { status: 400 });
        return Response.json({ ok: true, method: body.method, enabled: await setMethodEnabled(body.method, body.enabled) });
      }
      case "readNotifications": {
        const ids = Array.isArray(body.ids) ? body.ids.map(toId).filter((id): id is number => id !== null) : null;
        await markAdminNotificationsRead(ids);
        return Response.json({ ok: true });
      }
      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return errorResponse(error, "Admin");
  }
}
