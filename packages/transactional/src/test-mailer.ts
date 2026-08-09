import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { render, toPlainText } from "react-email";

import {
  Mailer,
  type MailMessage,
  type MailSendResult,
  MailPermanentDeliveryError,
  MailTemplateRenderError,
  MailTemporaryDeliveryError,
  MailUncertainDeliveryError,
} from "./mailer";

export interface RenderedTestEmail {
  readonly from?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly html: string;
  readonly messageId?: string;
  readonly subject: string;
  readonly text: string;
  readonly to: string;
}

/** A controlled provider result or classified failure for the next test send. */
export type TestMailerOutcome =
  | {
      readonly _tag: "accepted";
      readonly accepted?: boolean;
      readonly providerMessageId?: string;
      readonly responseCode?: number;
    }
  | { readonly _tag: "permanentFailure"; readonly smtpStatusCode?: number }
  | { readonly _tag: "temporaryFailure"; readonly smtpStatusCode?: number }
  | { readonly _tag: "uncertainFailure" };

export interface TestMailerState {
  readonly attempts: number;
  /** Legacy switch retained for existing workflow tests. */
  readonly failDelivery: boolean;
  readonly outcomes: readonly TestMailerOutcome[];
  readonly renderedMessages: readonly RenderedTestEmail[];
  readonly sentMessages: readonly MailMessage[];
}

export const initialTestMailerState: TestMailerState = {
  attempts: 0,
  failDelivery: false,
  outcomes: [],
  renderedMessages: [],
  sentMessages: [],
};

/** In-memory mailbox controls and observations for unit and end-to-end tests. */
export class TestMailer extends Context.Service<TestMailer>()("TestMailer", {
  make: Ref.make(initialTestMailerState),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

const defaultMessageId = (attempt: number): string =>
  `<test-mailer.${attempt}@notifications.feeblo>`;

const resultForOutcome = (
  message: MailMessage,
  attempt: number,
  outcome: Extract<TestMailerOutcome, { readonly _tag: "accepted" }> | undefined
): MailSendResult => {
  const accepted = outcome?.accepted ?? true;
  return {
    accepted,
    messageId: message.messageId ?? defaultMessageId(attempt),
    providerMetadata: {
      acceptedRecipientCount: accepted ? 1 : 0,
      ...(outcome?.providerMessageId
        ? { providerMessageId: outcome.providerMessageId }
        : {}),
      rejectedRecipientCount: accepted ? 0 : 1,
      ...(outcome?.responseCode === undefined
        ? {}
        : { responseCode: outcome.responseCode }),
    },
  };
};

const mailerLayer = Layer.effect(
  Mailer,
  Effect.gen(function* () {
    const mailbox = yield* TestMailer;

    return Mailer.of({
      send: Effect.fn("TestMailer.send")(function* (message: MailMessage) {
        const html = yield* Effect.tryPromise({
          try: () => render(message.react),
          catch: () => new MailTemplateRenderError({}),
        });
        const text = yield* Effect.try({
          try: () => toPlainText(html),
          catch: () => new MailTemplateRenderError({}),
        });
        const outcome = yield* Ref.modify(mailbox, (state) => {
          const [nextOutcome, ...remainingOutcomes] = state.outcomes;
          const resolvedOutcome =
            nextOutcome ??
            (state.failDelivery
              ? ({ _tag: "temporaryFailure" } as const)
              : ({ _tag: "accepted" } as const));
          const failed = resolvedOutcome._tag !== "accepted";

          return [
            resolvedOutcome,
            {
              ...state,
              attempts: state.attempts + 1,
              outcomes: remainingOutcomes,
              renderedMessages: failed
                ? state.renderedMessages
                : [
                    ...state.renderedMessages,
                    {
                      ...(message.from ? { from: message.from } : {}),
                      ...(message.headers ? { headers: message.headers } : {}),
                      ...(message.messageId
                        ? { messageId: message.messageId }
                        : {}),
                      html,
                      subject: message.subject,
                      text,
                      to: message.to,
                    },
                  ],
              sentMessages: failed
                ? state.sentMessages
                : [...state.sentMessages, message],
            },
          ];
        });

        switch (outcome._tag) {
          case "permanentFailure":
            return yield* new MailPermanentDeliveryError(
              outcome.smtpStatusCode === undefined
                ? {}
                : { smtpStatusCode: outcome.smtpStatusCode }
            );
          case "temporaryFailure":
            return yield* new MailTemporaryDeliveryError(
              outcome.smtpStatusCode === undefined
                ? {}
                : { smtpStatusCode: outcome.smtpStatusCode }
            );
          case "uncertainFailure":
            return yield* new MailUncertainDeliveryError({});
          case "accepted":
            return resultForOutcome(
              message,
              (yield* Ref.get(mailbox)).attempts,
              outcome
            );
        }
      }),
    });
  })
);

export const makeMailerTestLayer = (mailbox: Ref.Ref<TestMailerState>) =>
  mailerLayer.pipe(Layer.provideMerge(Layer.succeed(TestMailer, mailbox)));

/** Provides both `Mailer` and an inspectable in-memory `TestMailer` mailbox. */
export const MailerTestLayer = Layer.unwrap(
  TestMailer.make.pipe(Effect.map(makeMailerTestLayer))
);

export const resetTestMailer = (options?: {
  readonly failDelivery?: boolean;
  readonly outcomes?: readonly TestMailerOutcome[];
}) =>
  Effect.gen(function* () {
    const mailbox = yield* TestMailer;
    yield* Ref.set(mailbox, {
      ...initialTestMailerState,
      failDelivery: options?.failDelivery ?? false,
      outcomes: options?.outcomes ?? [],
    });
  });

export const testMailerState = Effect.gen(function* () {
  const mailbox = yield* TestMailer;
  return yield* Ref.get(mailbox);
});

export const sentTestEmails = testMailerState.pipe(
  Effect.map((state) => state.sentMessages)
);

/** Serializes the in-memory mailbox for black-box E2E assertions. */
export const renderedTestEmails = testMailerState.pipe(
  Effect.map((state) => state.renderedMessages)
);
