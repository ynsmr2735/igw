import { errorResponse, readJson, toId } from "@/lib/api";
import {
  approveDeposit,
  checkDepositOnChain,
  getAdminOverview,
  getDeposit,
  listAllTransactions,
  listDeposits,
  markAdminNotificationsRead,
  rejectDeposit,
  setBtcAddress,
} from "@/lib/admin";

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
      case "overview":
        return Response.json({ ok: true, overview: await getAdminOverview() });
      case "deposits":
        return Response.json({ ok: true, deposits: await listDeposits(typeof body.status === "string" ? body.status : null) });
      case "deposit": {
        const id = toId(body.id);
        if (id === null) return Response.json({ error: "Invalid id" }, { status: 400 });
        return Response.json({ ok: true, deposit: await getDeposit(id) });
      }
      case "verify": {
        const id = toId(body.id);
        if (id === null) return Response.json({ error: "Invalid id" }, { status: 400 });
        return Response.json({ ok: true, verification: await checkDepositOnChain(id) });
      }
      case "approve": {
        const id = toId(body.id);
        if (id === null) return Response.json({ error: "Invalid id" }, { status: 400 });
        return Response.json({ ok: true, ...(await approveDeposit(id)) });
      }
      case "reject": {
        const id = toId(body.id);
        if (id === null) return Response.json({ error: "Invalid id" }, { status: 400 });
        return Response.json({ ok: true, deposit: await rejectDeposit(id, String(body.reason ?? "")) });
      }
      case "transactions":
        return Response.json({ ok: true, transactions: await listAllTransactions() });
      case "setBtcAddress":
        return Response.json({ ok: true, btcAddress: await setBtcAddress(String(body.address ?? "")) });
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
