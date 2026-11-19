import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, getAuthSecret, verifySession } from "@/lib/auth/token";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, getAuthSecret());

  const isApi = path.startsWith("/api/dashboard") || path.startsWith("/api/transactions");
  const isProtected = path.startsWith("/dashboard") || isApi;
  const isAuthPage = path === "/login" || path === "/signup";

  if (!session && isApi) {
    return Response.json({ error: "You must be signed in" }, { status: 401 });
  }

  if (!session && isProtected) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (session && isAuthPage) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/dashboard/:path*", "/api/transactions/:path*", "/login", "/signup"],
};
