import { z } from "zod";
import { PasswordBusyError, hashPassword, mintSession, passwordBusyResponse } from "@/lib/auth";
import { getUserByUsername, isCompanionUserId, listUsers, setUserPassword } from "@/lib/db/users";
import { checkLogin, clientIp, recordLoginFailure, recordLoginSuccess, recordPasswordSuccess } from "@/lib/login-throttle";
import { isDeviceWorld } from "@/lib/server-env";
import { firstAccountTakesCode, setupCodeMatches } from "@/lib/setup-code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The way back in for the host of a world one of the apps runs. The host
// never knows their password: the app made it up and keeps it. When that
// password stops signing in (an older server let the host reset their own
// account from Admin > Users, issue 909), nothing the host can type opens
// the world again. The app still holds the setup code it handed this
// server at start (ODM_SETUP_CODE, src/lib/setup-code.ts), which only it
// knows, so the code is the proof: it sets a new password the app made up
// for the world's owner and answers with a bearer token, as /api/auth/token
// does. Anywhere else this route does not exist.
const recoverSchema = z.object({
  setupCode: z.string().trim().min(1).max(40),
  password: z.string().min(8).max(100),
  // The account the app kept for its host. When it names no admin here
  // (the app's record was lost), the world's first admin is its owner.
  username: z.string().trim().max(24).optional(),
});

// The host is the world's first account, the one the app claimed with the
// setup code. The named account is taken when it is an admin or that first
// account: a co-admin the host made can take the host's admin away, and the
// app must still get its own host back rather than the co-admin's account.
function worldOwner(username: string | undefined) {
  const users = listUsers();
  const named = username ? getUserByUsername(username) : null;
  if (named && !isCompanionUserId(named.id) && (named.isAdmin || named.id === users[0]?.id)) return named;
  return users.find((user) => user.isAdmin) ?? null;
}

export async function POST(request: Request) {
  if (!isDeviceWorld() || !firstAccountTakesCode()) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = recoverSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input." }, { status: 400 });
  }

  // A device world can be on the Wi-Fi or behind a tunnel, so wrong codes
  // share the login throttle's escalating lockout, keyed by IP.
  const ip = clientIp(request);
  const throttle = `recover-owner:${ip}`;
  const gate = checkLogin(throttle);
  if (gate.blocked) {
    return Response.json(
      { error: `Too many attempts. Try again in ${gate.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } },
    );
  }
  if (!setupCodeMatches(parsed.data.setupCode)) {
    recordLoginFailure(throttle);
    return Response.json({ error: "Only the app that hosts this world can do that." }, { status: 403 });
  }
  recordLoginSuccess(throttle);

  const owner = worldOwner(parsed.data.username);
  if (!owner) {
    return Response.json({ error: "This world has no owner yet." }, { status: 404 });
  }
  let hash: string;
  try {
    hash = await hashPassword(parsed.data.password);
  } catch (error) {
    if (error instanceof PasswordBusyError) {
      return passwordBusyResponse();
    }
    throw error;
  }
  // Also lifts the must-change gate a reset left behind: the host has no
  // form to answer it with.
  setUserPassword(owner.id, hash, false);
  // The failed renewals that led here may have locked the account's own
  // sign-in; the app signs in with the new password from now on.
  recordPasswordSuccess(owner.username, ip);
  const session = mintSession(owner.id);

  return Response.json({
    token: session.token,
    expiresAt: session.expiresAt,
    user: {
      id: owner.id,
      username: owner.username,
      avatar: owner.avatar,
      isAdmin: owner.isAdmin,
      mustChangePassword: false,
      deletionDueAt: owner.deletionDueAt,
    },
  });
}
