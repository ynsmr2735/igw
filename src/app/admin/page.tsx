import { notFound, redirect } from "next/navigation";
import AdminClient from "@/components/AdminClient";
import { getAdminOverview, listDeposits } from "@/lib/admin";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/admin");
  // Members get a plain 404: the admin area is not even acknowledged.
  if (!user.isAdmin) notFound();

  const [overview, deposits] = await Promise.all([getAdminOverview(), listDeposits(null)]);
  return <AdminClient initialOverview={overview} initialDeposits={deposits} />;
}
