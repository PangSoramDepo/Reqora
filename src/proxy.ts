import { NextResponse, type NextRequest } from "next/server";
import { sessionUser } from "@/lib/auth/session";

/**
 * Deny by default: everything except these prefixes needs a signed-in session, so routes added later
 * are protected without anyone remembering to opt in.
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/", // sign-in, sign-up, session status
  "/api/hooks/", // external webhook callers; they run deployed workflows only
  "/api/demo/", // local stand-in upstreams the seeded workflow calls server-to-server
];

const isPublic = (pathname: string) => PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const user = sessionUser(request);

  if (pathname === "/login" && user) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (isPublic(pathname) || user) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return Response.json(
      { type: "about:blank", title: "Unauthorized", status: 401, detail: "sign in required" },
      { status: 401, headers: { "content-type": "application/problem+json" } },
    );
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Skip framework assets; everything else goes through the check above.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
