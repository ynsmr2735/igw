import { AuthForm } from "@/components/AuthForm";

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  return <AuthForm mode="signup" next={params.next ?? "/dashboard"} />;
}
