import { getSessionToken } from "@/lib/auth/session";
import { toCardRequest, type CardRequest, type CardTier } from "@/lib/cards";
import { KYC_EXT, KYC_MAX_BYTES, sniffImageType, toKycSubmission, type KycDocumentType, type KycImageType, type KycSubmission } from "@/lib/kyc";
import { AuthError, RpcError, SetupError, rpc, serviceRequest } from "@/lib/supabase";
import { assertSchema } from "@/lib/system";

/**
 * Identity documents: upload to the PRIVATE Supabase Storage bucket "kyc-documents" with the
 * service role key (server only), then record them in the database. Nothing here is public:
 * there is no public URL; the admin sees the photos through /api/admin/kyc-file.
 */
export const KYC_BUCKET = "kyc-documents";

export type KycPhoto = { bytes: Uint8Array; type: KycImageType };

/** Checks one uploaded file: size and real image type (from its bytes). */
export function checkPhoto(bytes: Uint8Array, label: string): KycPhoto {
  if (bytes.length === 0) throw new RpcError(`Add a photo of the ${label}.`);
  if (bytes.length > KYC_MAX_BYTES) throw new RpcError(`The ${label} photo is too large (max ${KYC_MAX_BYTES / 1024 / 1024} MB).`);
  const type = sniffImageType(bytes);
  if (!type) throw new RpcError(`The ${label} file is not a photo. Upload a JPG, PNG or WebP image.`);
  return { bytes, type };
}

function objectUrl(path: string) {
  return `/storage/v1/object/${KYC_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function storageError(response: Response, what: string): Promise<Error> {
  const text = await response.text().catch(() => "");
  console.error(`KYC storage ${what} failed: ${response.status} ${text.slice(0, 300)}`);
  if (/bucket not found/i.test(text)) {
    return new SetupError('The private storage bucket "kyc-documents" is missing. Run the latest supabase/schema.sql in the Supabase SQL Editor.');
  }
  if (response.status === 401 || response.status === 403 || /unauthorized|invalid (jwt|signature|api key)|row-level security/i.test(text)) {
    return new SetupError("SUPABASE_SERVICE_ROLE_KEY is wrong or belongs to another project, so identity documents cannot be stored.");
  }
  return new RpcError("The identity documents could not be stored. Please try again.");
}

export async function storageUpload(path: string, photo: KycPhoto): Promise<void> {
  const response = await serviceRequest(objectUrl(path), {
    method: "POST",
    headers: { "Content-Type": photo.type, "x-upsert": "false", "cache-control": "no-store" },
    body: photo.bytes as unknown as BodyInit,
  });
  if (!response.ok) throw await storageError(response, "upload");
}

export async function storageDownload(path: string): Promise<Uint8Array> {
  const response = await serviceRequest(objectUrl(path));
  if (!response.ok) throw await storageError(response, "download");
  return new Uint8Array(await response.arrayBuffer());
}

export async function storageRemove(paths: string[]): Promise<void> {
  if (!paths.length) return;
  try {
    const response = await serviceRequest(`/storage/v1/object/${KYC_BUCKET}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: paths }),
    });
    if (!response.ok) console.error("KYC storage cleanup failed:", response.status, await response.text().catch(() => ""));
  } catch (error) {
    console.error("KYC storage cleanup failed:", error);
  }
}

/**
 * Member submits identity documents (optionally together with a card request).
 * Order: database check -> upload both photos -> record in one transaction.
 * If anything fails after an upload, the uploaded photos are deleted again.
 */
export async function submitKyc(input: {
  documentType: KycDocumentType;
  front: KycPhoto;
  back: KycPhoto;
  tier: CardTier | null;
  note: string;
}): Promise<{ kyc: KycSubmission; request: CardRequest | null }> {
  await assertSchema();
  const token = await getSessionToken();
  if (!token) throw new AuthError();
  const prep = await rpc<{ folder: string }>("igw_kyc_prepare", { p_token: token, p_tier: input.tier });
  const frontPath = `${prep.folder}/front.${KYC_EXT[input.front.type]}`;
  const backPath = `${prep.folder}/back.${KYC_EXT[input.back.type]}`;
  const uploaded: string[] = [];
  try {
    await storageUpload(frontPath, input.front);
    uploaded.push(frontPath);
    await storageUpload(backPath, input.back);
    uploaded.push(backPath);
    const raw = await rpc<{ kyc: unknown; request: unknown }>("igw_kyc_submit", {
      p_token: token,
      p_document_type: input.documentType,
      p_front_path: frontPath,
      p_front_type: input.front.type,
      p_front_size: input.front.bytes.length,
      p_back_path: backPath,
      p_back_type: input.back.type,
      p_back_size: input.back.bytes.length,
      p_tier: input.tier,
      p_note: input.note,
    });
    return { kyc: toKycSubmission(raw.kyc)!, request: raw.request ? toCardRequest(raw.request as Record<string, unknown>) : null };
  } catch (error) {
    await storageRemove(uploaded);
    throw error;
  }
}
