import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { Api } from "../http/api";
import * as RateLimit from "../rate-limit";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import { NotificationPreferenceRepository } from "./repository";
import {
  NotificationPreferenceTokenService,
  type NotificationPreferenceUnsubscribeClaims,
} from "./tokens";

const invalidLink = () =>
  new BadRequestError({
    message: "Notification preference unsubscribe link is invalid",
  });

/** Verifies the stateless token and answers its claims, or `BadRequest`. */
const verifyUnsubscribeToken = (
  token: string
): Effect.Effect<
  NotificationPreferenceUnsubscribeClaims,
  BadRequestError,
  NotificationPreferenceTokenService
> =>
  Effect.gen(function* () {
    const tokens = yield* NotificationPreferenceTokenService;
    const claims = yield* tokens
      .verifyToken(token)
      .pipe(Effect.mapError(invalidLink));
    if (Option.isNone(claims)) {
      return yield* invalidLink();
    }
    return claims.value;
  });

/**
 * Validates a one-click unsubscribe link without writing anything.
 *
 * Link scanners and mail clients prefetch GET URLs, so the GET side only
 * confirms the token; the RFC 8058 POST is the state-changing half.
 */
export const validateNotificationPreferenceUnsubscribeToken = (token: string) =>
  verifyUnsubscribeToken(token).pipe(Effect.as({ valid: true }));

/**
 * RFC 8058 one-click unsubscribe for member notification email.
 *
 * The token is stateless and carries the claims, so the click writes the same
 * category row the settings page would: disabling that one category, never the
 * workspace-wide pause. A replayed click is idempotent.
 */
export const unsubscribeNotificationPreference = (token: string) =>
  Effect.gen(function* () {
    const repository = yield* NotificationPreferenceRepository;
    const claims = yield* verifyUnsubscribeToken(token);
    yield* repository
      .setPreference({
        category: claims.category,
        channel: "email",
        enabled: false,
        organizationId: claims.organizationId,
        userId: claims.userId,
      })
      .pipe(withRemapDbErrors("NotificationPreference", "update"));
    return { unsubscribed: true };
  });

export const NotificationPreferenceApiLive = HttpApiBuilder.group(
  Api,
  "NotificationPreferenceApiGroup",
  (handlers) =>
    handlers
      .handle("unsubscribeNotificationPreferenceLink", ({ query }) =>
        validateNotificationPreferenceUnsubscribeToken(query.token).pipe(
          RateLimit.withPublicHttpRateLimit({
            name: "NotificationPreferenceUnsubscribeLink",
            level: "read",
          })
        )
      )
      .handle("unsubscribeNotificationPreference", ({ query }) =>
        unsubscribeNotificationPreference(query.token).pipe(
          RateLimit.withPublicHttpRateLimit({
            name: "NotificationPreferenceUnsubscribe",
            level: "write",
          })
        )
      )
).pipe(
  Layer.provide(NotificationPreferenceRepository.layer),
  Layer.provide(NotificationPreferenceTokenService.layer)
);
