/**
 * Middleware to protect routes with authentication
 */

import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isOnLoginPage = req.nextUrl.pathname.startsWith("/login");
  const isOnApiAuth = req.nextUrl.pathname.startsWith("/api/auth");

  // Allow access to login page and auth API routes
  if (isOnLoginPage || isOnApiAuth) {
    return NextResponse.next();
  }
  /*
  // Redirect to login if not authenticated
  if (!isLoggedIn) {
    // Use the external URL from NEXTAUTH_URL or construct from headers
    const protocol = req.headers.get("x-forwarded-proto") || "https";
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
    const loginUrl = new URL("/login", `${protocol}://${host}`);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
*/
  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};


