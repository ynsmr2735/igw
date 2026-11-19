import { redirect } from "next/navigation";
import DashboardClient from "@/components/DashboardClient";
import { getSessionUser } from "@/lib/auth/session";
import { getDashboardData } from "@/lib/wallet";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // The proxy checks the cookie signature; this also checks the profile exists.
  if (!(await getSessionUser())) redirect("/login?next=/dashboard");

  const data = await getDashboardData();
  return <DashboardClient initialData={data} />;
}
