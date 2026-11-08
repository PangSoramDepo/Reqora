import "server-only";

import type { NextRequest, NextResponse } from "next/server";
import { WORKSPACE_COOKIE } from "./schema";

/** Remembers the workspace the app shows for this browser (list and create requests use it). */
export function selectWorkspace(response: NextResponse, request: NextRequest, workspaceId: string) {
  response.cookies.set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 365 * 24 * 3600,
  });
}
