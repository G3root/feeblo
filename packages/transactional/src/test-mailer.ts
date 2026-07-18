import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { MailDeliveryError, Mailer, type MailMessage } from "./mailer";

export interface TestMailerState {
  readonly attempts: number;
  readonly failDelivery: boolean;
  readonly sentMessages: readonly MailMessage[];
}

export const initialTestMailerState: TestMailerState = {
  attempts: 0,
  failDelivery: false,
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
      send: (message) =>
        Ref.modify(mailbox, (state) => [
          state.failDelivery,
          {
            ...state,
            attempts: state.attempts + 1,
            sentMessages: state.failDelivery
              ? state.sentMessages
              : [...state.sentMessages, message],
          },
        ]).pipe(
          Effect.flatMap((failDelivery) =>
            failDelivery
              ? Effect.fail(
                  new MailDeliveryError({
                    subject: message.subject,
                    cause: new Error("Test mail delivery failure"),
                  })
                )
              : Effect.void
          )
        ),
    });
  })
);

/** Provides both `Mailer` and an inspectable in-memory `TestMailer` mailbox. */
export const MailerTestLayer = mailerLayer.pipe(
  Layer.provideMerge(TestMailer.layer)
);

export const resetTestMailer = (options?: { readonly failDelivery?: boolean }) =>
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
