import {
  MailDeliveryError,
  Mailer,
  MailTemplateRenderError,
} from "@feeblo/transactional/mailer";
import { createUserFeedbackEmail } from "@feeblo/transactional/templates/user-feedback";
import { createUserOnboardingEmail } from "@feeblo/transactional/templates/user-onboarding";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";
import * as W from "effect/unstable/workflow";

export const WelcomeUserWorkflow = W.Workflow.make({
  name: "WelcomeUserWorkflow",
  payload: {
    userId: S.String,
    email: S.String,
    name: S.String,
    dashboardUrl: S.String,
  },
  error: S.Union([MailTemplateRenderError, MailDeliveryError]),
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
      error: S.Union([MailTemplateRenderError, MailDeliveryError]),

      execute: Effect.gen(function* () {
        const mailer = yield* Mailer;

        //TODO take a look later
        yield* mailer.send({
          ...createUserOnboardingEmail({
            dashboardUrl: payload.dashboardUrl,
            name: payload.name,
          }),
          messageId: `<welcome.${payload.userId}@notifications.feeblo>`,
          to: payload.email,
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
      error: S.Union([MailTemplateRenderError, MailDeliveryError]),

      execute: Effect.gen(function* () {
        const mailer = yield* Mailer;

        yield* mailer.send({
          ...createUserFeedbackEmail({
            feedbackUrl: "https://feedback.feeblo.com",
            name: payload.name,
          }),
          messageId: `<feedback-request.${payload.userId}@notifications.feeblo>`,
          to: payload.email,
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
