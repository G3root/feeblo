import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import { Api } from "../http/api";
import { JwtSecretRepository } from "../jwt-secret/repository";
import { UnauthorizedError, withRemapDbErrors } from "../rpc-errors";
import { FeedbackIngestionRepository } from "./repository";
import { FeedbackIngestionService } from "./service";
import {
  ExternalIngestionAuthMiddlewareLive,
  ExternalIngestionWorkspace,
} from "./external-auth";

export const FeedbackIngestionApiLive = HttpApiBuilder.group(
  Api,
  "FeedbackIngestionApiGroup",
  (handlers) =>
    handlers.handle("captureExternalFeedback", ({ payload }) =>
      Effect.gen(function* () {
        const credential = yield* ExternalIngestionWorkspace;
        if (credential.organizationId !== payload.organizationId) {
          return yield* new UnauthorizedError({
            message: "Credential does not belong to this workspace",
          });
        }
        const ingestion = yield* FeedbackIngestionService;
        return yield* ingestion.capture({
          ...payload,
          metadata: {
            ...payload.metadata,
            transport: "external-http",
          },
        });
      }).pipe(withRemapDbErrors("Feedback", "create"))
    )
).pipe(
  Layer.provide(ExternalIngestionAuthMiddlewareLive),
  Layer.provide(JwtSecretRepository.layer),
  Layer.provide(FeedbackIngestionService.layer),
  Layer.provide(FeedbackIngestionRepository.layer)
);
