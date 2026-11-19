import DashboardClient from "@/components/DashboardClient";
import { getDashboardData } from "@/lib/wallet";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const data = await getDashboardData();
  return <DashboardClient initialData={data} />;
}
