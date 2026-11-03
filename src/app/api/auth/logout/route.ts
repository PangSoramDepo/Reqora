import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, clearSessionCookie } from "@/lib/auth/session";
import { deleteSession } from "@/lib/auth/store";

export async function POST(request: NextRequest) {
  deleteSession(request.cookies.get(SESSION_COOKIE)?.value);
  const response = new NextResponse(null, { status: 204 });
  clearSessionCookie(response);
  return response;
}
