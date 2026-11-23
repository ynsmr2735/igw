import { redirect } from "next/navigation";
import DashboardClient from "@/components/DashboardClient";
import { ForcedPasswordChange } from "@/components/ChangePassword";
import { signOutAction } from "@/app/auth/actions";
import { getSessionUser } from "@/lib/auth/session";
import { PasswordChangeRequiredError } from "@/lib/supabase";
import { getDashboardData } from "@/lib/wallet";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let data;
  try {
    data = await getDashboardData();
  } catch (error) {
    // Temporary password after an admin reset: a new password first, then the wallet.
    if (error instanceof PasswordChangeRequiredError) {
      const user = await getSessionUser();
      if (!user) redirect("/login?next=/dashboard");
      return <ForcedPasswordChange name={user.name} signOut={signOutAction} />;
    }
    throw error;
  }
  if (!data) redirect("/login?next=/dashboard");
  return <DashboardClient initialData={data} />;
}
