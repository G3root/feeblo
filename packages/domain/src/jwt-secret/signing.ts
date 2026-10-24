import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as jose from "jose";

import { InternalServerError } from "../rpc-errors";
import { secretToKey } from "./verification";

/**
 * How long a minted widget identity token stays valid.
 *
 * `docs/widget-sso.md` recommends ≤ 5 minutes because a customer's backend
 * mints one per page load. The dashboard mints one per widget open and the
 * widget keeps it for the life of the form, so the same bound would expire
 * under a half-written report; 15 minutes covers a form session while staying
 * far below the workspace's own cap (`organization.jwt_max_token_lifetime_
 * minutes`, 24h by default), which is what bounds replay of a leaked token.
 */
export const WIDGET_IDENTITY_TOKEN_LIFETIME = Duration.minutes(15);

export interface WidgetIdentityClaims {
  /** Becomes the contact's `externalId`; the widget keys SSO identity on it. */
  readonly email: string;
  /**
   * Stored unverified by the widget (`iss` is informational for now), and
   * minted for the deployment's own app URL so the claim is correct if it is
   * ever promoted to required.
   */
  readonly issuer: string;
  /** Required: the widget rejects a token without a name. */
  readonly name: string;
  /** `aud`. A token minted for one workspace is rejected at every other. */
  readonly organizationId: string;
  /** `sub`. The stable string identifier of the person submitting. */
  readonly subject: string;
}

export interface SignedWidgetIdentity {
  /** The `exp` instant, so the caller can bound its own cache of the token. */
  readonly expiresAt: Date;
  readonly token: string;
}

/**
 * Mints the identity token the widget's feedback path verifies
 * (`verifyJwt` → `parsePersonAttributes` → contact upsert). The claims are the
 * contract in `docs/widget-sso.md`: `sub`, `email` and `name` identify the
 * person, `aud` pins the token to one workspace, and `iat`/`exp` are required
 * and checked against the workspace's lifetime cap.
 *
 * Time is read through `Clock` rather than the wall clock and every time claim
 * is set explicitly, so a test can pin `TestClock` and the claims agree with
 * the verifier's own clock read.
 */
export const signWidgetIdentityToken = ({
  email,
  issuer,
  name,
  organizationId,
  secret,
  subject,
}: WidgetIdentityClaims & { readonly secret: string }) =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const issuedAt = Math.floor(DateTime.toEpochMillis(now) / 1000);
    const expiresAtSeconds =
      issuedAt + Duration.toSeconds(WIDGET_IDENTITY_TOKEN_LIFETIME);

    const token = yield* Effect.tryPromise({
      try: () =>
        new jose.SignJWT({ email, name })
          .setProtectedHeader({ alg: "HS256" })
          .setSubject(subject)
          .setAudience(organizationId)
          .setIssuer(issuer)
          .setIssuedAt(issuedAt)
          .setExpirationTime(expiresAtSeconds)
          .sign(secretToKey(secret)),
      catch: () =>
        new InternalServerError({
          message: "Failed to sign the widget identity token",
        }),
    });

    return {
      expiresAt: DateTime.toDate(
        DateTime.addDuration(now, WIDGET_IDENTITY_TOKEN_LIFETIME)
      ),
      token,
    } satisfies SignedWidgetIdentity;
  });
