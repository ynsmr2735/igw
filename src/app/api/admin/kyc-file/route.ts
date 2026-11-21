import { errorResponse, toId } from "@/lib/api";
import { kycFile } from "@/lib/admin";
import { sniffImageType } from "@/lib/kyc";
import { storageDownload } from "@/lib/kyc-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/kyc-file?id=<submission>&side=front|back
 * Streams one identity photo from the private bucket to a signed-in admin. The database checks
 * the admin session (igw_admin_kyc_file); nothing is cached and there is no public URL.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = toId(url.searchParams.get("id"));
  const side = url.searchParams.get("side");
  if (id === null || (side !== "front" && side !== "back")) {
    return Response.json({ error: "id and side=front|back are required" }, { status: 400 });
  }
  try {
    const file = await kycFile(id, side);
    const bytes = await storageDownload(file.path);
    const type = sniffImageType(bytes);
    if (!type) return Response.json({ error: "Stored file is not an image" }, { status: 422 });
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="kyc-${id}-${side}.${type.split("/")[1]}"`,
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return errorResponse(error, "Identity document");
  }
}
