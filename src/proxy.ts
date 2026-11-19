import { NextResponse, type NextRequest } from "next/server";

// Kept in sync with src/lib/auth/session.ts. The proxy only checks that a
// well-formed token exists; the database verifies it on every request.
const SESSION_COOKIE = "igw_session";
const SESSION_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const hasSession = SESSION_TOKEN_PATTERN.test(request.cookies.get(SESSION_COOKIE)?.value ?? "");

  const isApi = path.startsWith("/api/dashboard") || path.startsWith("/api/transactions");
  const isProtected = path.startsWith("/dashboard") || isApi;

  if (!hasSession && isApi) {
    return Response.json({ error: "You must be signed in" }, { status: 401 });
  }

  if (!hasSession && isProtected) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // Signed-in users visiting /login or /signup are redirected by those pages,
  // after the token is verified in the database (an expired cookie would loop here).
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/dashboard/:path*", "/api/transactions/:path*"],
};
