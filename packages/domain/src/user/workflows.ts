import { MailerConfig, MESSAGE_ID_DOMAIN } from "@feeblo/transactional/config";
import {
  Mailer,
  MailProviderDeliveryError,
  MailTemplateRenderError,
} from "@feeblo/transactional/mailer";
import { createUserFeedbackEmail } from "@feeblo/transactional/templates/user-feedback";
import { createUserOnboardingEmail } from "@feeblo/transactional/templates/user-onboarding";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";
import * as W from "effect/workflow";

import { sendUnlessSuppressed } from "../email-suppression/guard";
import { EmailSuppressionDataError } from "../email-suppression/schema";

export const WelcomeUserWorkflow = W.Workflow.make("WelcomeUserWorkflow", {
  payload: {
    userId: S.String,
    email: S.String,
    name: S.String,
    dashboardUrl: S.String,
  },
  error: S.Union([
    MailTemplateRenderError,
    MailProviderDeliveryError,
    EmailSuppressionDataError,
  ]),
  idempotencyKey: ({ userId }) => userId,
});

export const WelcomeUserWorkflowLayer = WelcomeUserWorkflow.toLayer(
  Effect.fnUntraced(function* (payload, executionId) {
    yield* Effect.annotateLogsScoped({
      userId: payload.userId,
      email: payload.email,
      executionId,
    });

    yield* W.DurableClock.sleep({
      name: `delay-welcome-email-${payload.userId}`,
      duration: "2 hours",
    });

    yield* W.Activity.make({
      name: "SendWelcomeEmail",
      error: S.Union([
        MailTemplateRenderError,
        MailProviderDeliveryError,
        EmailSuppressionDataError,
      ]),

      execute: Effect.gen(function* () {
        const mailer = yield* Mailer;
        const { personalFrom } = yield* MailerConfig;

        yield* sendUnlessSuppressed({
          email: payload.email,
          organizationId: null,
          send: mailer
            .send({
              ...createUserOnboardingEmail({
                dashboardUrl: payload.dashboardUrl,
                name: payload.name,
              }),
              ...(personalFrom._tag === "Some" && { from: personalFrom.value }),
              messageId: `<welcome.${payload.userId}@${MESSAGE_ID_DOMAIN}>`,
              to: payload.email,
            })
            .pipe(Effect.asVoid),
        });
      }),
    }).pipe(
      Effect.tapError((error) =>
        Effect.logError("SendWelcomeEmail failed").pipe(
          Effect.annotateLogs({
            error: String(error),
            ...payload,
          })
        )
      )
    );

    yield* W.DurableClock.sleep({
      name: `delay-welcome-email-experience-${payload.userId}`,
      duration: "6 days",
    });

    yield* W.Activity.make({
      name: "SendUserFeedbackEmail",
      error: S.Union([
        MailTemplateRenderError,
        MailProviderDeliveryError,
        EmailSuppressionDataError,
      ]),

      execute: Effect.gen(function* () {
        const mailer = yield* Mailer;
        const { personalFrom } = yield* MailerConfig;

        yield* sendUnlessSuppressed({
          email: payload.email,
          organizationId: null,
          send: mailer
            .send({
              ...createUserFeedbackEmail({
                feedbackUrl: "https://feedback.feeblo.com",
                name: payload.name,
              }),
              ...(personalFrom._tag === "Some" && {
                from: personalFrom.value,
              }),
              messageId: `<feedback-request.${payload.userId}@${MESSAGE_ID_DOMAIN}>`,
              to: payload.email,
            })
            .pipe(Effect.asVoid),
        });
      }),
    }).pipe(
      Effect.tapError((error) =>
        Effect.logError("SendUserFeedbackEmail failed").pipe(
          Effect.annotateLogs({
            error: String(error),
            ...payload,
          })
        )
      )
    );
  })
);
