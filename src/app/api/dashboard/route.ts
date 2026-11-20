import { errorResponse } from "@/lib/api";
import { getDashboardData } from "@/lib/wallet";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getDashboardData();
    if (!data) return Response.json({ error: "You must be signed in" }, { status: 401 });
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "Dashboard");
  }
}
