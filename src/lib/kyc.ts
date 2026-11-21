/**
 * Identity verification (KYC): shared types and checks (server + browser, no secrets).
 * The photos are stored in a private Supabase Storage bucket; only the server reads them.
 */

export type KycDocumentType = "national_id" | "driving_licence" | "passport";
export type KycStatus = "none" | "pending" | "approved" | "rejected";

export type KycSubmission = {
  id: number;
  reference: string;
  documentType: KycDocumentType;
  documentName: string;
  status: Exclude<KycStatus, "none">;
  rejectionReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export type KycState = { status: KycStatus; submission: KycSubmission | null };

export const KYC_DOCUMENTS: { id: KycDocumentType; label: string; front: string; back: string }[] = [
  { id: "national_id", label: "ID card", front: "Front side", back: "Back side" },
  { id: "driving_licence", label: "Driving licence", front: "Front side", back: "Back side" },
  { id: "passport", label: "Passport", front: "Photo page", back: "Back / signature page" },
];

export const KYC_STATUS_LABEL: Record<KycStatus, string> = {
  none: "Not verified",
  pending: "Under review",
  approved: "Verified",
  rejected: "Rejected",
};

/** Per photo, after the browser shrinks it. Two photos must fit in one request (< 4.5 MB on Vercel). */
export const KYC_MAX_BYTES = 2 * 1024 * 1024;
export const KYC_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type KycImageType = (typeof KYC_TYPES)[number];
export const KYC_EXT: Record<KycImageType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function isKycDocumentType(v: unknown): v is KycDocumentType {
  return v === "national_id" || v === "driving_licence" || v === "passport";
}

/** Real file type from the first bytes (the browser's Content-Type is not trusted). */
export function sniffImageType(bytes: Uint8Array): KycImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "image/png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  return null;
}

export function toKycSubmission(raw: unknown): KycSubmission | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    id: Number(r.id),
    reference: String(r.reference ?? ""),
    documentType: (isKycDocumentType(r.documentType) ? r.documentType : "national_id"),
    documentName: String(r.documentName ?? ""),
    status: (r.status === "approved" || r.status === "rejected" ? r.status : "pending"),
    rejectionReason: typeof r.rejectionReason === "string" ? r.rejectionReason : null,
    createdAt: String(r.createdAt ?? ""),
    reviewedAt: typeof r.reviewedAt === "string" ? r.reviewedAt : null,
  };
}

export function toKycState(raw: unknown): KycState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const status: KycStatus = r.status === "pending" || r.status === "approved" || r.status === "rejected" ? r.status : "none";
  return { status, submission: toKycSubmission(r.submission) };
}

/** Admin view: member details + image info. */
export type AdminKycSubmission = KycSubmission & {
  userName: string;
  email: string;
  accountNumber: string;
  frontType: string;
  backType: string;
  frontSize: number;
  backSize: number;
  reviewedBy: string | null;
  pendingCardRequest: { id: number; reference: string; tier: string; tierName?: string } | null;
};

export function toAdminKyc(raw: unknown): AdminKycSubmission | null {
  const base = toKycSubmission(raw);
  if (!base) return null;
  const r = raw as Record<string, unknown>;
  const pcr = r.pendingCardRequest as Record<string, unknown> | null;
  return {
    ...base,
    userName: String(r.userName ?? ""),
    email: String(r.email ?? ""),
    accountNumber: String(r.accountNumber ?? ""),
    frontType: String(r.frontType ?? ""),
    backType: String(r.backType ?? ""),
    frontSize: Number(r.frontSize ?? 0),
    backSize: Number(r.backSize ?? 0),
    reviewedBy: typeof r.reviewedBy === "string" ? r.reviewedBy : null,
    pendingCardRequest: pcr ? { id: Number(pcr.id), reference: String(pcr.reference ?? ""), tier: String(pcr.tier ?? ""), tierName: typeof pcr.tierName === "string" ? pcr.tierName : undefined } : null,
  };
}

/** URL of an identity photo for the admin (streamed by the server after an admin check). */
export function kycImageUrl(id: number, side: "front" | "back"): string {
  return `/api/admin/kyc-file?id=${id}&side=${side}`;
}
