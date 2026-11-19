import { getDashboardData } from "@/lib/wallet";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getDashboardData();
    return Response.json(data);
  } catch (error) {
    console.error("Dashboard verisi alınamadı:", error);
    return Response.json({ error: "Veriler yüklenemedi" }, { status: 500 });
  }
}
