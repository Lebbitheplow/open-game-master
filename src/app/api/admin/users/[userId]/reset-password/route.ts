import { randomBytes } from "node:crypto";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { PasswordBusyError, hashPassword, passwordBusyResponse } from "@/lib/auth";
import {
  deleteSessionsForUser,
  getUserById,
  setUserPassword,
} from "@/lib/db/users";
import { isDeviceWorld } from "@/lib/server-env";
import { HOST_ACCOUNT_REFUSAL, deviceWorldHostId } from "@/lib/setup-code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Generates a temporary password, shows it to the admin exactly once, and
// forces the user through the change-password flow on their next login. All
// of the user's sessions are revoked.
//
// Never the admin's own account (#909): the reset ends the session that
// asked for it, so the page is signed out before the temporary password
// can be read. In the desktop app the owner's password is one the app made
// up and keeps, so nothing could sign that owner back in to their world.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const { userId } = await params;
  const target = getUserById(userId);
  if (!target) {
    return Response.json({ error: "User not found." }, { status: 404 });
  }
  if (target.id === admin.id) {
    return Response.json(
      {
        // A world one of the apps hosts has no Password section in Settings:
        // the app keeps the host's password, so there is nothing to change.
        error: isDeviceWorld()
          ? "You can't reset your own password: it would sign you out of your own world."
          : "You can't reset your own password: it would sign you out. Change it in Settings.",
      },
      { status: 400 },
    );
  }
  if (target.id === deviceWorldHostId()) {
    return Response.json({ error: HOST_ACCOUNT_REFUSAL }, { status: 403 });
  }
  const tempPassword = randomBytes(9).toString("base64url");
  let hash: string;
  try {
    hash = await hashPassword(tempPassword);
  } catch (error) {
    if (error instanceof PasswordBusyError) {
      return passwordBusyResponse();
    }
    throw error;
  }
  setUserPassword(target.id, hash, true);
  deleteSessionsForUser(target.id);
  return Response.json({ tempPassword });
}
