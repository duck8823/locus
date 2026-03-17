import { auth } from "auth";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = new Set(["/login", "/api/auth"]);

function isPublicPath(pathname: string): boolean {
  for (const prefix of PUBLIC_PATHS) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return true;
    }
  }
  return false;
}

function isAuthEnabled(): boolean {
  return !!process.env.AUTH_SECRET;
}

export default auth((req) => {
  // Skip auth enforcement when AUTH_SECRET is not configured (demo/CI mode)
  if (!isAuthEnabled()) {
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
