import { notFound, redirect } from "next/navigation";
import AdminClient from "@/components/AdminClient";
import { getAdminOverview, listDeposits } from "@/lib/admin";
import { getSessionUser } from "@/lib/auth/session";
import { SetupError } from "@/lib/supabase";
import { getSystemStatus } from "@/lib/system";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/admin");
  // Members get a plain 404: the admin area is not even acknowledged.
  if (!user.isAdmin) notFound();

  const status = await getSystemStatus();
  try {
    const [overview, deposits] = await Promise.all([getAdminOverview(), listDeposits(null)]);
    return <AdminClient initialOverview={overview} initialDeposits={deposits} initialStatus={status} />;
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    // Show the real reason instead of an empty or broken panel.
    return (
      <main lang="en" className="mx-auto max-w-[760px] px-4 py-10 text-[#10152b]">
        <h1 className="text-xl font-black">Admin panel: setup problem</h1>
        <p className="mt-3 rounded-2xl border border-rose-300 bg-rose-50 p-4 text-[13px] font-semibold text-rose-700" role="alert">
          {error.message}
        </p>
        <ul className="mt-4 space-y-2 text-[13px]" data-testid="setup-status">
          {status.map((s) => (
            <li key={s.key} className={s.ok ? "text-emerald-700" : s.required ? "text-rose-700" : "text-amber-700"}>
              {s.ok ? "✔" : "✘"} <b>{s.label}</b> — {s.detail}
            </li>
          ))}
        </ul>
      </main>
    );
  }
}
