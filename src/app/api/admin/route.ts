import { errorResponse, readJson, toId } from "@/lib/api";
import {
  ApprovalError,
  approveDeposit,
  checkDepositOnChain,
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
import { testBitcoinExplorers } from "@/lib/btc/chain";
import { getSystemStatus } from "@/lib/system";
import { testTronGrid } from "@/lib/tron/chain";
import { requireAdminSession } from "@/lib/admin";

export const dynamic = "force-dynamic";
// Approving waits for blockchain APIs; give the function enough time on Vercel.
export const maxDuration = 60;

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
      case "testChain": {
        await requireAdminSession();
        const [btc, tron] = await Promise.all([testBitcoinExplorers(), testTronGrid()]);
        return Response.json({ ok: true, btc, tron });
      }
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
        try {
          return Response.json({ ok: true, ...(await approveDeposit(id, { acceptReceived: body.acceptReceived === true })) });
        } catch (error) {
          // Real reason + the blockchain result, so the admin sees exactly what is missing.
          if (error instanceof ApprovalError) {
            return Response.json(
              { error: error.message, verification: error.verification, mismatch: error.mismatch },
              { status: error.mismatch ? 409 : 400 },
            );
          }
          throw error;
        }
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
