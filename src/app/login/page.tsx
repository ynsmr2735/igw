import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { safeNextPath } from "@/lib/auth/redirect";
import { getSessionUser } from "@/lib/auth/session";
import { passwordHelp } from "@/lib/contact";
import { getContactInfo } from "@/lib/contact-server";

export const dynamic = "force-dynamic";

export default async function LoginPage({
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

  // "Forgot / change password" -> support WhatsApp (Admin -> Contact details).
  const help = passwordHelp(await getContactInfo());
  return <AuthForm mode="login" next={next} passwordHelp={help} />;
}
