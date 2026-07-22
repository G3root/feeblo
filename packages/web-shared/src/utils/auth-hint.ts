/** biome-ignore-all lint/suspicious/noDocumentCookie: This module owns the client-readable auth hint cookie. */

// ---------------------------------------------------------------------------
// Auth-hint cookie — the client-readable "probably signed in" signal.
//
// Better Auth's session cookie is HttpOnly, so a client-only React root cannot
// read it while its first session request is pending. This cookie is the safe
// companion: `AuthProvider` writes a display-only identity snapshot whenever
// `meAtom` confirms a session and reads it on the next page load.
//
// It is a HINT, never an authority. Every API request is still authenticated
// with the real Better Auth cookie on the server, and membership roles are
// deliberately excluded. A stale or forged hint can only affect the brief
// loading paint before the authoritative session atom resolves.
//
// Encoding and decoding stay DOM-free so Astro middleware and other server
// seams can share the exact wire format if needed.
// ---------------------------------------------------------------------------

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const AUTH_HINT_COOKIE = "feeblo-auth-hint";
export const AUTH_HINT_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const AuthHintSchema = Schema.Struct({
  v: Schema.Literal(1),
  user: Schema.Struct({
    id: Schema.String,
    email: Schema.String,
    name: Schema.String,
    image: Schema.NullOr(Schema.String),
  }),
  organizations: Schema.Array(
    Schema.Struct({
      id: Schema.String,
    })
  ),
});

export type AuthHint = typeof AuthHintSchema.Type;

const AuthHintFromJson = Schema.fromJsonString(AuthHintSchema);
const decodeAuthHintJson = Schema.decodeUnknownOption(AuthHintFromJson);
// Cookie values are percent-encoded. Truncation can make decodeURIComponent
// throw, which must be treated as an absent hint rather than breaking render.
const decodeUriComponentOption = Option.liftThrowable(decodeURIComponent);
const encodeAuthHintJson = Schema.encodeSync(AuthHintFromJson);

export const encodeAuthHint = (hint: AuthHint): string =>
  encodeURIComponent(encodeAuthHintJson(hint));

export const decodeAuthHint = (
  value: string | null | undefined
): AuthHint | null => {
  if (!value) {
    return null;
  }

  return decodeUriComponentOption(value).pipe(
    Option.flatMap(decodeAuthHintJson),
    Option.getOrNull
  );
};

// ── Browser-side cookie maintenance (AuthProvider) ───────────────────────────

export const writeAuthHintCookie = (hint: AuthHint): void => {
  document.cookie = `${AUTH_HINT_COOKIE}=${encodeAuthHint(hint)}; Path=/; Max-Age=${AUTH_HINT_MAX_AGE_SECONDS}; SameSite=Lax${
    window.location.protocol === "https:" ? "; Secure" : ""
  }`;
};

export const clearAuthHintCookie = (): void => {
  document.cookie = `${AUTH_HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
};

export const readAuthHintCookie = (): AuthHint | null => {
  const prefix = `${AUTH_HINT_COOKIE}=`;
  const cookie = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));

  return decodeAuthHint(cookie?.slice(prefix.length));
};
