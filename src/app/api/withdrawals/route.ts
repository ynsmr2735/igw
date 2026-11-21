import { errorResponse, readJson, toAmount, toId } from "@/lib/api";
import { isCardTier, type CardTier } from "@/lib/cards";
import { isKycDocumentType } from "@/lib/kyc";
import { checkPhoto, submitKyc } from "@/lib/kyc-server";
import { cancelCardRequest, cancelWithdrawal, createWithdrawal, requestCard } from "@/lib/withdrawals";

export const dynamic = "force-dynamic";

/**
 * Cards and crypto withdrawals (member).
 *   { action: "requestCard", tier, note }        -> card request for the admin (no fee)
 *   { action: "cancelCardRequest", id }
 *   { action: "create", amountUsd, btcAddress }  -> withdrawal request (needs an active card)
 *   { action: "cancel", id }                     -> cancel own pending withdrawal (amount returned)
 *
 * Identity documents (multipart/form-data): action=requestCard|submitKyc, documentType,
 * front, back (photos), consent=yes, tier (requestCard), note. The photos go to the private
 * storage bucket; the card request and the documents are recorded together.
 */
export async function POST(request: Request) {
  if ((request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    return kycUpload(request);
  }
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

async function kycUpload(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "The upload could not be read. Please try again (max. 2 MB per photo)." }, { status: 400 });
  }
  const action = form.get("action");
  if (action !== "requestCard" && action !== "submitKyc") return Response.json({ error: "Unknown action" }, { status: 400 });
  const tier = action === "requestCard" ? form.get("tier") : null;
  if (action === "requestCard" && !isCardTier(tier)) {
    return Response.json({ error: "Choose a card: Standard, Gold, Premium or Merchant." }, { status: 400 });
  }
  const documentType = form.get("documentType");
  if (!isKycDocumentType(documentType)) {
    return Response.json({ error: "Choose the document: ID card, driving licence or passport." }, { status: 400 });
  }
  if (form.get("consent") !== "yes") {
    return Response.json({ error: "Confirm that the documents are yours and may be used to verify your identity." }, { status: 400 });
  }
  const front = form.get("front");
  const back = form.get("back");
  if (!(front instanceof Blob) || !(back instanceof Blob)) {
    return Response.json({ error: "Add photos of both sides of the document." }, { status: 400 });
  }
  try {
    const result = await submitKyc({
      documentType,
      front: checkPhoto(new Uint8Array(await front.arrayBuffer()), documentType === "passport" ? "photo page" : "front side"),
      back: checkPhoto(new Uint8Array(await back.arrayBuffer()), documentType === "passport" ? "back page" : "back side"),
      tier: action === "requestCard" ? (tier as CardTier) : null,
      note: String(form.get("note") ?? "").slice(0, 300),
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error, "Identity documents");
  }
}
