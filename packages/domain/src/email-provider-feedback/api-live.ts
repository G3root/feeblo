import { timingSafeEqual } from "node:crypto";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { Api } from "../http/api";
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
  withRemapDbErrors,
} from "../rpc-errors";
import { EmailProviderFeedbackConfig } from "./config";
import { EmailProviderFeedbackService } from "./service";

const matchesProviderWebhookToken = (
  suppliedToken: string,
  configuredToken: Redacted.Redacted<string>
): boolean => {
  const supplied = Buffer.from(suppliedToken);
  const configured = Buffer.from(Redacted.value(configuredToken));
  return (
    supplied.length === configured.length &&
    timingSafeEqual(supplied, configured)
  );
};

/** Implements authenticated, idempotent provider lifecycle event ingestion. */
export const EmailProviderFeedbackApiLive = HttpApiBuilder.group(
  Api,
  "EmailProviderFeedbackApiGroup",
  (handlers) =>
    handlers.handle("ingestEmailProviderFeedback", ({ headers, payload }) =>
      Effect.gen(function* () {
        const config = yield* EmailProviderFeedbackConfig;
        if (
          !matchesProviderWebhookToken(
            headers["x-email-provider-token"],
            config.webhookToken
          )
        ) {
          return yield* new UnauthorizedError({
            message: "Email provider webhook authentication failed",
          });
        }
        const service = yield* EmailProviderFeedbackService;
        const result = yield* service.ingest(payload).pipe(
          Effect.catchTags({
            EmailProviderFeedbackInputError: (error) =>
              Effect.fail(new BadRequestError({ message: error.message })),
            EmailProviderFeedbackDataError: (error) =>
              Effect.fail(new InternalServerError({ message: error.message })),
          }),
          withRemapDbErrors("EmailProviderFeedback", "update")
        );
        switch (result._tag) {
          case "Duplicate":
            return { result: "duplicate" as const };
          case "Processed":
            return { result: "processed" as const };
          case "UnknownDelivery":
            return { result: "unknown_delivery" as const };
          default:
            return result satisfies never;
        }
      })
    )
).pipe(
  Layer.provide(EmailProviderFeedbackConfig.layer),
  Layer.provide(EmailProviderFeedbackService.layer)
);
