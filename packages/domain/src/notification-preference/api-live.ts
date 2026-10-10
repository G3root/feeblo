import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { Api } from "../http/api";
import * as RateLimit from "../rate-limit";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import { NotificationPreferenceRepository } from "./repository";
import { NotificationPreferenceTokenService } from "./tokens";

/**
 * RFC 8058 one-click unsubscribe for member notification email.
 *
 * The token is stateless and carries the claims, so the click writes the same
 * category row the settings page would: disabling that one category, never the
 * workspace-wide pause. A replayed click is idempotent.
 */
export const unsubscribeNotificationPreference = (token: string) =>
  Effect.gen(function* () {
    const tokens = yield* NotificationPreferenceTokenService;
    const repository = yield* NotificationPreferenceRepository;
    const claims = yield* tokens.verifyToken(token).pipe(
      Effect.mapError(
        () =>
          new BadRequestError({
            message: "Notification preference unsubscribe link is invalid",
          })
      )
    );
    if (Option.isNone(claims)) {
      return yield* new BadRequestError({
        message: "Notification preference unsubscribe link is invalid",
      });
    }
    yield* repository
      .setPreference({
        category: claims.value.category,
        channel: "email",
        enabled: false,
        organizationId: claims.value.organizationId,
        userId: claims.value.userId,
      })
      .pipe(withRemapDbErrors("NotificationPreference", "update"));
    return { unsubscribed: true };
  });

export const NotificationPreferenceApiLive = HttpApiBuilder.group(
  Api,
  "NotificationPreferenceApiGroup",
  (handlers) => {
    const unsubscribe = (token: string) =>
      unsubscribeNotificationPreference(token).pipe(
        RateLimit.withPublicHttpRateLimit({
          name: "NotificationPreferenceUnsubscribe",
          level: "read",
        })
      );

    return handlers
      .handle("unsubscribeNotificationPreferenceLink", ({ query }) =>
        unsubscribe(query.token)
      )
      .handle("unsubscribeNotificationPreference", ({ query }) =>
        unsubscribe(query.token)
      );
  }
).pipe(
  Layer.provide(NotificationPreferenceRepository.layer),
  Layer.provide(NotificationPreferenceTokenService.layer)
);
