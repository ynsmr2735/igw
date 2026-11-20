import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { safeNextPath } from "@/lib/auth/redirect";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;

  let signedIn = false;
  try {
    signedIn = Boolean(await getSessionUser());
  } catch (error) {
    // Supabase not reachable / not configured: still show the form, the action reports the reason.
    console.error("Session check failed:", error);
  }
  const next = safeNextPath(params.next);
  if (signedIn) redirect(next);

  return <AuthForm mode="signup" next={next} />;
}
