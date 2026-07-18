import { render, toPlainText } from "@react-email/render";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import {
  MailDeliveryError,
  Mailer,
  type MailMessage,
  MailTemplateRenderError,
} from "./mailer";

export interface RenderedTestEmail {
  readonly from?: string;
  readonly html: string;
  readonly subject: string;
  readonly text: string;
  readonly to: string;
}

export interface TestMailerState {
  readonly attempts: number;
  readonly failDelivery: boolean;
  readonly renderedMessages: readonly RenderedTestEmail[];
  readonly sentMessages: readonly MailMessage[];
}

export const initialTestMailerState: TestMailerState = {
  attempts: 0,
  failDelivery: false,
  renderedMessages: [],
  sentMessages: [],
};

/** In-memory mailbox controls and observations for unit and end-to-end tests. */
export class TestMailer extends Context.Service<TestMailer>()("TestMailer", {
  make: Ref.make(initialTestMailerState),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

const mailerLayer = Layer.effect(
  Mailer,
  Effect.gen(function* () {
    const mailbox = yield* TestMailer;

    return Mailer.of({
      send: Effect.fn("TestMailer.send")(function* (message) {
        const html = yield* Effect.tryPromise({
          try: () => render(message.react),
          catch: (cause) =>
            new MailTemplateRenderError({
              subject: message.subject,
              cause,
            }),
        });
        const text = toPlainText(html);
        const failDelivery = yield* Ref.modify(mailbox, (state) => {
          return [
            state.failDelivery,
            {
              ...state,
              attempts: state.attempts + 1,
              renderedMessages: state.failDelivery
                ? state.renderedMessages
                : [
                    ...state.renderedMessages,
                    {
                      ...(message.from ? { from: message.from } : {}),
                      html,
                      subject: message.subject,
                      text,
                      to: message.to,
                    },
                  ],
              sentMessages: state.failDelivery
                ? state.sentMessages
                : [...state.sentMessages, message],
            },
          ];
        });

        if (failDelivery) {
          return yield* new MailDeliveryError({
            subject: message.subject,
            cause: new Error("Test mail delivery failure"),
          });
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
}) =>
  Effect.gen(function* () {
    const mailbox = yield* TestMailer;
    yield* Ref.set(mailbox, {
      ...initialTestMailerState,
      failDelivery: options?.failDelivery ?? false,
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
