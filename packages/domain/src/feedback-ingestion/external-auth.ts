import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";
import * as HttpApiSecurity from "effect/unstable/httpapi/HttpApiSecurity";
import { JwtSecretRepository } from "../jwt-secret/repository";
import { UnauthorizedError } from "../rpc-errors";

export class ExternalIngestionWorkspace extends Context.Service<
  ExternalIngestionWorkspace,
  { readonly organizationId: string }
>()("@feeblo/domain/ExternalIngestionWorkspace") {}

export class ExternalIngestionAuthMiddleware extends HttpApiMiddleware.Service<
  ExternalIngestionAuthMiddleware,
  { provides: ExternalIngestionWorkspace }
>()("@feeblo/domain/ExternalIngestionAuthMiddleware", {
  error: UnauthorizedError,
  security: { bearer: HttpApiSecurity.bearer },
}) {}

export const ExternalIngestionAuthMiddlewareLive = Layer.effect(
  ExternalIngestionAuthMiddleware,
  Effect.gen(function* () {
    const secrets = yield* JwtSecretRepository;
    return {
      bearer: (effect, { credential }) =>
        Effect.gen(function* () {
          const organizationId =
            yield* secrets.findActiveOrganizationForSecret(
              Redacted.value(credential)
            ).pipe(
              Effect.mapError(
                () =>
                  new UnauthorizedError({
                    message: "Unable to validate ingestion credential",
                  })
              )
            );
          if (!organizationId) {
            return yield* new UnauthorizedError({
              message: "Invalid or revoked ingestion credential",
            });
          }
          return yield* effect.pipe(
            Effect.provideService(ExternalIngestionWorkspace, {
              organizationId,
            })
          );
        }),
    };
  })
);
