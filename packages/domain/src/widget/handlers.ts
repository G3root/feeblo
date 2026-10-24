import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { JwtSecretRepository } from "../jwt-secret/repository";
import { signWidgetIdentityToken } from "../jwt-secret/signing";
import {
  InternalServerError,
  NotFoundError,
  withRemapDbErrors,
} from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { FeedbackWidgetConfig } from "./config";
import { WidgetRpcs } from "./rpcs";

export const WidgetRpcHandlersEffect = Effect.gen(function* () {
  const config = yield* FeedbackWidgetConfig;
  const jwtSecretRepository = yield* JwtSecretRepository;

  return {
    /**
     * Mints the widget identity token for the signed-in user.
     *
     * The signing key is the widget workspace's own active secret — the only
     * key the widget verifies with — so a rotation in Settings → Security takes
     * effect here without a second place to update. A deployment (or a
     * workspace) without one answers with an error, and the dashboard leaves
     * the widget anonymous rather than failing the click.
     */
    GetFeedbackWidgetIdentity: () =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const { appUrl, organizationId } = config;

        if (!organizationId) {
          return yield* new NotFoundError({
            message: "This deployment has no feedback widget configured",
          });
        }

        const secrets = yield* jwtSecretRepository.getSecretsForOrg({
          organizationId,
        });
        const active = secrets.find((secret) => secret.revokedAt === null);

        if (!active) {
          return yield* new InternalServerError({
            message:
              "The feedback widget workspace has no signing secret. Generate one in Settings -> Security.",
          });
        }

        const { email, id: userId, name } = session.user;
        // The widget rejects a token without both claims, and a user row with
        // a blank name is possible, so the address stands in rather than
        // turning every submission from that account into a rejected token.
        const displayName = name.trim() === "" ? email : name;

        const { token } = yield* signWidgetIdentityToken({
          email,
          issuer: appUrl,
          name: displayName,
          organizationId,
          secret: active.secret,
          subject: userId,
        });

        return {
          token,
          user: { email, id: userId, name: displayName },
        };
      }).pipe(withRemapDbErrors("JwtSecret", "select")),
  };
});

export const WidgetRpcHandlers = WidgetRpcs.toLayer(
  WidgetRpcHandlersEffect
).pipe(Layer.provide(JwtSecretRepository.layer));
