import { currentUser, unauthorized } from "@/lib/auth";
import type { User } from "@/lib/db/users";

// The signed-in holder of mind seats (docs/specs/ogm-mind-seats.md). Holding
// a seat is not membership: these routes reach only the holder's own minds.
export async function requireSeatHolder(): Promise<User | Response> {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  if (user.mustChangePassword) {
    return Response.json({ error: "Set a new password to continue." }, { status: 403 });
  }
  return user;
}
