"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Clock3, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { KYC_DOCUMENTS, KYC_MAX_BYTES, KYC_STATUS_LABEL, type KycDocumentType, type KycState } from "@/lib/kyc";
import { formatDate } from "@/lib/format";

/** A photo prepared in the browser: re-encoded as JPEG (removes EXIF/GPS), max 1800 px. */
type PreparedPhoto = { blob: Blob; url: string; width: number; height: number };

const MAX_SIDE = 1800;
const MIN_SIDE = 320;

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw new Error("This photo cannot be opened. Take a new photo or choose a JPG or PNG image.");
    }
  }
}

async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (file.type && !file.type.startsWith("image/")) throw new Error("Choose a photo (JPG, PNG or WebP), not a document file.");
  if (file.size > 40 * 1024 * 1024) throw new Error("This file is too large. Take a normal photo with your phone camera.");
  const img = await decode(file);
  try {
    if (Math.min(img.width, img.height) < MIN_SIDE) throw new Error("The photo is too small to read. Take a closer, sharper photo.");
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const width = Math.round(img.width * scale);
    const height = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser cannot prepare the photo. Try another browser.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img.source, 0, 0, width, height);
    let blob: Blob | null = null;
    for (const quality of [0.88, 0.8, 0.72, 0.64, 0.56]) {
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= KYC_MAX_BYTES * 0.9) break;
    }
    if (!blob || blob.size > KYC_MAX_BYTES * 0.9) throw new Error("The photo is too large. Take the photo again a little further away.");
    return { blob, url: URL.createObjectURL(blob), width, height };
  } finally {
    img.close();
  }
}

/** Member's identity status line (Withdraw section and profile). */
export function KycStatusLine({ kyc }: { kyc: KycState }) {
  const s = kyc.status;
  const Icon = s === "approved" ? CheckCircle2 : s === "pending" ? Clock3 : s === "rejected" ? XCircle : ShieldCheck;
  const tone =
    s === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : s === "pending" ? "border-amber-200 bg-amber-50 text-amber-900"
    : s === "rejected" ? "border-rose-200 bg-rose-50 text-rose-800"
    : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <div className={`flex items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-[12px] ${tone}`} data-testid="kyc-status" data-status={s}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-black">Identity verification: {KYC_STATUS_LABEL[s]}</p>
        {kyc.submission && s !== "none" && (
          <p className="mt-0.5 opacity-80">
            {kyc.submission.documentName} · ref. <span className="font-mono">{kyc.submission.reference}</span> · {formatDate(kyc.submission.createdAt)}
          </p>
        )}
        {s === "rejected" && kyc.submission?.rejectionReason && <p className="mt-1">Reason: {kyc.submission.rejectionReason}. Please upload new photos.</p>}
        {s === "none" && <p className="mt-0.5 opacity-80">Needed to activate a card: photos of your ID card, driving licence or passport.</p>}
      </div>
    </div>
  );
}

function PhotoInput({ id, label, photo, busy, onPick }: { id: string; label: string; photo: PreparedPhoto | null; busy: boolean; onPick: (file: File) => void }) {
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <label
        htmlFor={id}
        className={`relative flex aspect-[1.586] w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed text-center transition ${
          photo ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 bg-slate-50 hover:border-purple-300"
        }`}
        data-testid={`${id}-box`}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.url} alt={`${label} preview`} className="h-full w-full object-contain" />
        ) : (
          <>
            {busy ? <Loader2 className="h-6 w-6 animate-spin text-[#7F00FF]" /> : <Camera className="h-6 w-6 text-slate-400" />}
            <span className="mt-2 text-[12px] font-bold text-slate-600">{busy ? "Preparing photo…" : "Take or choose a photo"}</span>
            <span className="mt-0.5 text-[11px] text-slate-400">All four corners visible, no glare</span>
          </>
        )}
        <input
          ref={input}
          id={id}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
          className="sr-only"
          aria-label={label}
          onChange={(e) => {
            const file = (e.target as unknown as HTMLInputElement).files?.[0];
            if (file) onPick(file);
            if (input.current) input.current.value = "";
          }}
        />
      </label>
      {photo && (
        <button type="button" onClick={() => input.current?.click()} className="mt-1.5 text-[11px] font-bold text-[#7F00FF]">
          Change photo
        </button>
      )}
    </div>
  );
}

/** Identity document fields (document type, front + back photos, consent). */
export function useKycForm() {
  const [documentType, setDocumentType] = useState<KycDocumentType>("national_id");
  const [front, setFront] = useState<PreparedPhoto | null>(null);
  const [back, setBack] = useState<PreparedPhoto | null>(null);
  const [consent, setConsent] = useState(false);
  const [preparing, setPreparing] = useState<"front" | "back" | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => () => {
    if (front) URL.revokeObjectURL(front.url);
  }, [front]);
  useEffect(() => () => {
    if (back) URL.revokeObjectURL(back.url);
  }, [back]);

  async function pick(side: "front" | "back", file: File) {
    setPreparing(side);
    setPhotoError(null);
    try {
      const photo = await preparePhoto(file);
      (side === "front" ? setFront : setBack)(photo);
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "This photo cannot be used.");
    } finally {
      setPreparing(null);
    }
  }

  const doc = KYC_DOCUMENTS.find((d) => d.id === documentType)!;

  const fields = (
    <fieldset className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4" data-testid="kyc-fields">
      <legend className="px-1 text-[13px] font-black">Identity verification</legend>
      <p className="text-[12px] text-slate-600">
        To activate a card we need to verify your identity. Upload clear photos of <b>both sides</b> of one document in your name.
      </p>
      <div role="radiogroup" aria-label="Identity document" className="grid grid-cols-3 gap-2">
        {KYC_DOCUMENTS.map((d) => (
          <button
            key={d.id}
            type="button"
            role="radio"
            aria-checked={documentType === d.id}
            onClick={() => setDocumentType(d.id)}
            className={`rounded-xl border-2 px-2 py-2.5 text-[12px] font-bold transition ${
              documentType === d.id ? "border-[#7F00FF] bg-purple-50/60 text-[#10152b]" : "border-slate-200 text-slate-600 hover:border-purple-200"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <PhotoInput id="kyc-front" label={`${doc.label}: ${doc.front}`} photo={front} busy={preparing === "front"} onPick={(f) => pick("front", f)} />
        <PhotoInput id="kyc-back" label={`${doc.label}: ${doc.back}`} photo={back} busy={preparing === "back"} onPick={(f) => pick("back", f)} />
      </div>
      {photoError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-600" data-testid="kyc-photo-error">{photoError}</p>}
      <label className="flex items-start gap-2.5 text-[12px] text-slate-600">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#7F00FF]" data-testid="kyc-consent" />
        <span>I confirm this document is mine and agree that Insta Global Wallet stores these photos to verify my identity. Only authorised staff can see them.</span>
      </label>
    </fieldset>
  );

  return {
    fields,
    preparing: preparing !== null,
    /** Error message for a missing part, or null when everything is filled in. */
    missing(): string | null {
      if (!front || !back) return `Add photos of both sides: ${doc.front.toLowerCase()} and ${doc.back.toLowerCase()}.`;
      if (!consent) return "Confirm that the document is yours and may be used to verify your identity.";
      return null;
    },
    appendTo(form: FormData) {
      form.append("documentType", documentType);
      if (front) form.append("front", front.blob, "front.jpg");
      if (back) form.append("back", back.blob, "back.jpg");
      form.append("consent", consent ? "yes" : "no");
    },
    reset() {
      setFront(null);
      setBack(null);
      setConsent(false);
      setPhotoError(null);
    },
  };
}

/** POST multipart (photos) to an API route; same error handling as postJson. */
export async function postForm<T>(url: string, form: FormData, loginNext = "/dashboard"): Promise<T> {
  const response = await fetch(url, { method: "POST", body: form });
  if (response.status === 401) {
    window.location.assign(`/login?next=${encodeURIComponent(loginNext)}`);
    throw new Error("Your session has ended. Please sign in again.");
  }
  if (response.status === 428) {
    window.location.assign("/dashboard");
    throw new Error("Please set a new password first.");
  }
  if (response.status === 413) throw new Error("The photos are too large to upload. Take them again a little further away.");
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data;
}
