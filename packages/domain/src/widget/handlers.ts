import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

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

  /**
   * `FEEDBACK_WIDGET_SSO_SECRET` when the deployment provides one — the widget
   * workspace's own key, held in env so nothing depends on a click in Settings
   * → Security — and otherwise the workspace's active stored secret, which is
   * what a rotation updates. Both must be the key the widget verifies with, so
   * the two are one credential in two places: an env value that does not match
   * the workspace's produces tokens the widget rejects.
   */
  const resolveSigningSecret = (
    organizationId: string,
    envSecret: string | undefined
  ) =>
    Effect.gen(function* () {
      if (envSecret !== undefined) {
        return envSecret;
      }

      const secrets = yield* jwtSecretRepository.getSecretsForOrg({
        organizationId,
      });
      const active = secrets.find((secret) => secret.revokedAt === null);

      if (!active) {
        return yield* new InternalServerError({
          message:
            "The feedback widget workspace has no signing secret. Set FEEDBACK_WIDGET_SSO_SECRET, or generate one in Settings -> Security.",
        });
      }

      return active.secret;
    });

  return {
    /**
     * Mints the widget identity token for the signed-in user.
     *
     * A deployment without a configured workspace, or without a key, answers
     * with an error; the dashboard leaves the widget usable so the report still
     * arrives, anonymously, instead of the click failing.
     */
    GetFeedbackWidgetIdentity: () =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const { appUrl, organizationId, ssoSecret } = config;

        if (!organizationId) {
          return yield* new NotFoundError({
            message: "This deployment has no feedback widget configured",
          });
        }

        const secret = yield* resolveSigningSecret(
          organizationId,
          ssoSecret === undefined ? undefined : Redacted.value(ssoSecret)
        );

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
          secret,
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
