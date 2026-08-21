import { hasWindow } from "@feeblo/utils/runtime-kind";
import { AUTH_SESSION_DURATION_SECONDS } from "@feeblo/auth/session";
import * as Schema from "effect/Schema";

// ---------------------------------------------------------------------------
// Display-only auth hint cookie.
//
// A client-readable (non-HttpOnly) cookie that lets the UI paint the last
// confirmed identity — email, name, avatar — synchronously on boot, while
// `meAtom` is still resolving the authoritative session over the network.
//
// This cookie is NOT authorization, and it is not a secret:
//
// - It is written by the client from `meAtom`'s resolved session, so it can
//   be forged or edited by the user it belongs to. That is acceptable: it
//   only changes what that user's own browser displays. Every privileged
//   action is authorized server-side against the HttpOnly Better Auth
//   session cookie, never against this value.
// - It may be stale (a session revoked elsewhere, or a sign-out in another
//   tab, leaves it behind until the next resolution). Consumers must treat
//   it purely as a paint optimization that the atom's response replaces.
// ---------------------------------------------------------------------------

const HINT_COOKIE_NAME = "feeblo_auth_hint";

/** Display identity persisted for anti-flash painting; never authorization. */
export interface AuthHintUser {
  readonly email: string;
  readonly image: string | null;
  readonly name: string;
}

interface AuthHintPayload {
  readonly user: AuthHintUser;
  readonly v: 1;
}

// The cookie is client-writable, so its payload is untrusted input at an I/O
// boundary: parse it with a schema instead of probing field types. Unknown
// keys are ignored (the default) so newer payloads stay readable.
const AuthHintPayloadSchema = Schema.Struct({
  user: Schema.Struct({
    email: Schema.String,
    image: Schema.NullOr(Schema.String),
    name: Schema.String,
  }),
  v: Schema.Literal(1),
});

function serializeAuthHint(user: AuthHintUser): string {
  const payload: AuthHintPayload = { user, v: 1 };
  // Percent-encoding keeps JSON structural characters cookie-safe.
  return encodeURIComponent(JSON.stringify(payload));
}

function deserializeAuthHint(value: string): AuthHintUser | null {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    return Schema.is(AuthHintPayloadSchema)(parsed) ? parsed.user : null;
  } catch {
    return null;
  }
}

/**
 * Persist the display identity from a confirmed session. Called by `meAtom`
 * after every successful resolution so the cookie's lifetime tracks session
 * activity.
 */
export function writeAuthHintToCookie(user: AuthHintUser): void {
  if (!hasWindow()) {
    return;
  }

  document.cookie = [
    `${HINT_COOKIE_NAME}=${serializeAuthHint(user)}`,
    `Max-Age=${AUTH_SESSION_DURATION_SECONDS}`,
    "Path=/",
    "SameSite=Lax",
    ...(window.location.protocol === "https:" ? ["Secure"] : []),
  ].join("; ");
}

/** Drop the display identity; called when the session resolves to signed-out. */
export function clearAuthHintCookie(): void {
  if (!hasWindow()) {
    return;
  }

  document.cookie = [
    `${HINT_COOKIE_NAME}=`,
    "Max-Age=0",
    "Path=/",
    "SameSite=Lax",
    ...(window.location.protocol === "https:" ? ["Secure"] : []),
  ].join("; ");
}

/**
 * Read the cached display identity, or null when absent/corrupt. Invalid or
 * outdated payloads are treated as no hint rather than an error.
 */
export function readAuthHintFromCookie(): AuthHintUser | null {
  if (!hasWindow()) {
    return null;
  }

  const prefix = `${HINT_COOKIE_NAME}=`;
  const entry = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(prefix));

  return entry ? deserializeAuthHint(entry.slice(prefix.length)) : null;
}
