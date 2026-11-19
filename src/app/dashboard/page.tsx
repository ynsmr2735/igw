import { redirect } from "next/navigation";
import DashboardClient from "@/components/DashboardClient";
import { getDashboardData } from "@/lib/wallet";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const data = await getDashboardData();
  if (!data) redirect("/login?next=/dashboard");
  return <DashboardClient initialData={data} />;
}
