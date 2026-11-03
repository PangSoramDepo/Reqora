import { connection, type NextRequest } from "next/server";
import { signupOpen } from "@/lib/auth/schema";
import { sessionUser } from "@/lib/auth/session";
import { countUsers } from "@/lib/auth/store";

/** Who is signed in (or null), and whether the sign-in page should offer account creation. */
export async function GET(request: NextRequest) {
  await connection();
  const user = sessionUser(request);
  const users = countUsers();
  return Response.json({
    user: user ? { id: user.id, email: user.email, name: user.name } : null,
    signupOpen: signupOpen(users),
    firstRun: users === 0,
  });
}
