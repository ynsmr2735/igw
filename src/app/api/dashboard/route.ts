import { getSessionUser } from "@/lib/auth/session";
import { getDashboardData } from "@/lib/wallet";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await getSessionUser())) {
      return Response.json({ error: "You must be signed in" }, { status: 401 });
    }
    const data = await getDashboardData();
    return Response.json(data);
  } catch (error) {
    console.error("Dashboard verisi alınamadı:", error);
    return Response.json({ error: "Veriler yüklenemedi" }, { status: 500 });
  }
}
