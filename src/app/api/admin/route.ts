import { ACCOUNT_NUMBER_HINT, isAccountNumber, normalizeAccountNumber } from "@/lib/format";
import { errorResponse, readJson, toAmount, toId } from "@/lib/api";
import {
  approveDeposit,
  approveWithdrawal,
  decideCardRequest,
  decideKyc,
  getMemberDetail,
  listMembers,
  resetMemberPassword,
  listKyc,
  listCardRequests,
  listCards,
  listWithdrawals,
  lookupMember,
  rejectWithdrawal,
  setCard,
  getAdminOverview,
  getDeposit,
  listAllTransactions,
  listDeposits,
  markAdminNotificationsRead,
  pollAdmin,
  rejectDeposit,
  setDepositAddress,
  setMethodEnabled,
  setContact,
} from "@/lib/admin";
import { isCardTier } from "@/lib/cards";
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
      case "setContact": {
        const raw = body.contact;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return Response.json({ error: "contact must be an object" }, { status: 400 });
        const input = raw as Record<string, unknown>;
        const contact: Record<string, string> = {};
        for (const key of ["email", "phone", "whatsapp", "telegram", "address", "hours"]) {
          const v = input[key];
          if (v !== undefined && v !== null && typeof v !== "string") return Response.json({ error: `${key} must be text` }, { status: 400 });
          contact[key] = String(v ?? "").slice(0, 400);
        }
        return Response.json({ ok: true, contact: await setContact(contact) });
      }
      case "withdrawals":
        return Response.json({ ok: true, withdrawals: await listWithdrawals(typeof body.status === "string" ? body.status : null) });
      case "approveWithdrawal": {
        const id = toId(body.id);
        if (id === null) return Response.json({ error: "Invalid id" }, { status: 400 });
        const txid = typeof body.txid === "string" ? body.txid : null;
        return Response.json({ ok: true, withdrawal: await approveWithdrawal(id, txid) });
      }
      case "rejectWithdrawal": {
        const id = toId(body.id);
        if (id === null) return Response.json({ error: "Invalid id" }, { status: 400 });
        return Response.json({ ok: true, withdrawal: await rejectWithdrawal(id, String(body.reason ?? "")) });
      }
      case "cardRequests":
        return Response.json({ ok: true, requests: await listCardRequests(typeof body.status === "string" ? body.status : null) });
      case "decideCardRequest": {
        const id = toId(body.id);
        if (id === null) return Response.json({ error: "Invalid id" }, { status: 400 });
        if (typeof body.approve !== "boolean") return Response.json({ error: "approve must be true or false" }, { status: 400 });
        return Response.json({ ok: true, request: await decideCardRequest(id, body.approve, typeof body.reason === "string" ? body.reason : null) });
      }
      case "members": {
        const search = typeof body.search === "string" ? body.search.slice(0, 120) : "";
        const offset = Number.isInteger(body.offset) && (body.offset as number) >= 0 ? (body.offset as number) : 0;
        return Response.json({ ok: true, ...(await listMembers(search, offset)) });
      }
      case "memberDetail":
      case "resetPassword": {
        const account = normalizeAccountNumber(String(body.accountNumber ?? ""));
        if (!isAccountNumber(account)) return Response.json({ error: ACCOUNT_NUMBER_HINT }, { status: 400 });
        if (body.action === "memberDetail") return Response.json({ ok: true, member: await getMemberDetail(account) });
        return Response.json({ ok: true, ...(await resetMemberPassword(account)) });
      }
      case "kyc": {
        const status = body.status === "pending" || body.status === "approved" || body.status === "rejected" ? body.status : null;
        return Response.json({ ok: true, submissions: await listKyc(status) });
      }
      case "decideKyc": {
        const id = toId(body.id);
        if (id === null) return Response.json({ error: "Invalid id" }, { status: 400 });
        if (typeof body.approve !== "boolean") return Response.json({ error: "approve must be true or false" }, { status: 400 });
        return Response.json({ ok: true, kyc: await decideKyc(id, body.approve, typeof body.reason === "string" ? body.reason : null) });
      }
      case "cards":
        return Response.json({ ok: true, cards: await listCards() });
      case "setCard": {
        const account = normalizeAccountNumber(String(body.accountNumber ?? ""));
        if (!isAccountNumber(account)) return Response.json({ error: ACCOUNT_NUMBER_HINT }, { status: 400 });
        if (typeof body.active !== "boolean") return Response.json({ error: "active must be true or false" }, { status: 400 });
        if (body.active && !isCardTier(body.tier)) return Response.json({ error: "Choose a card: Standard, Gold, Premium or Merchant." }, { status: 400 });
        const card = await setCard(account, isCardTier(body.tier) ? body.tier : null, body.active, typeof body.reason === "string" ? body.reason : null);
        return Response.json({ ok: true, card });
      }
      case "lookupMember": {
        const account = normalizeAccountNumber(String(body.accountNumber ?? ""));
        if (!isAccountNumber(account)) return Response.json({ error: ACCOUNT_NUMBER_HINT }, { status: 400 });
        return Response.json({ ok: true, member: await lookupMember(account) });
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
