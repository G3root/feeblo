import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { MailerConfig } from "./config";

const loadMailerConfig = (
  environment: Record<string, string | undefined> = {}
) =>
  MailerConfig.make.pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromUnknown(environment)
    )
  );

describe("MailerConfig personal sender", () => {
  it.effect(
    "defaults to no sender override when SMTP_PERSONAL_FROM_ADDRESS is unset",
    () =>
      Effect.gen(function* () {
        const config = yield* loadMailerConfig({
          SMTP_PERSONAL_FROM_ADDRESS: undefined,
        });

        expect(Option.isNone(config.personalFrom)).toBe(true);
      })
  );

  it.effect("reads SMTP_PERSONAL_FROM_ADDRESS when set", () =>
    Effect.gen(function* () {
      const config = yield* loadMailerConfig({
        SMTP_PERSONAL_FROM_ADDRESS: "nafees@example.test",
      });

      expect(Option.getOrElse(config.personalFrom, () => "unset")).toBe(
        "nafees@example.test"
      );
    })
  );

  it.effect("treats a blank SMTP_PERSONAL_FROM_ADDRESS as unset", () =>
    Effect.gen(function* () {
      const config = yield* loadMailerConfig({
        SMTP_PERSONAL_FROM_ADDRESS: "   ",
      });

      expect(Option.isNone(config.personalFrom)).toBe(true);
    })
  );
});

describe("MailerConfig sender display names", () => {
  it.effect("falls back to the bare address when SMTP_FROM_NAME is unset", () =>
    Effect.gen(function* () {
      const config = yield* loadMailerConfig({
        SMTP_FROM_ADDRESS: "noreply@example.test",
      });

      expect(config.defaultFrom).toBe("noreply@example.test");
    })
  );

  it.effect("renders SMTP_FROM_NAME as the display name", () =>
    Effect.gen(function* () {
      const config = yield* loadMailerConfig({
        SMTP_FROM_ADDRESS: "noreply@example.test",
        SMTP_FROM_NAME: "Feeblo",
      });

      expect(config.defaultFrom).toBe("Feeblo <noreply@example.test>");
    })
  );

  it.effect("quotes a display name RFC 5322 cannot carry unquoted", () =>
    Effect.gen(function* () {
      const comma = yield* loadMailerConfig({
        SMTP_FROM_ADDRESS: "noreply@example.test",
        SMTP_FROM_NAME: "Feeblo, Inc",
      });
      const quote = yield* loadMailerConfig({
        SMTP_FROM_ADDRESS: "noreply@example.test",
        SMTP_FROM_NAME: 'Nafees "Naf" Nazik',
      });

      expect(comma.defaultFrom).toBe('"Feeblo, Inc" <noreply@example.test>');
      expect(quote.defaultFrom).toBe(
        '"Nafees \\"Naf\\" Nazik" <noreply@example.test>'
      );
    })
  );

  it.effect("leaves an address that already carries a display name alone", () =>
    Effect.gen(function* () {
      const config = yield* loadMailerConfig({
        SMTP_FROM_ADDRESS: "Nafees <nafees@example.test>",
        SMTP_FROM_NAME: "Feeblo",
      });

      expect(config.defaultFrom).toBe("Nafees <nafees@example.test>");
    })
  );

  it.effect("names the personal sender independently of SMTP_FROM_NAME", () =>
    Effect.gen(function* () {
      const config = yield* loadMailerConfig({
        SMTP_FROM_NAME: "Feeblo",
        SMTP_PERSONAL_FROM_ADDRESS: "nafees@example.test",
        SMTP_PERSONAL_FROM_NAME: "Nafees",
      });

      expect(Option.getOrElse(config.personalFrom, () => "unset")).toBe(
        "Nafees <nafees@example.test>"
      );
    })
  );

  it.effect(
    "does not label the personal sender with the default sender's name",
    () =>
      Effect.gen(function* () {
        const config = yield* loadMailerConfig({
          SMTP_FROM_NAME: "Feeblo",
          SMTP_PERSONAL_FROM_ADDRESS: "nafees@example.test",
        });

        expect(Option.getOrElse(config.personalFrom, () => "unset")).toBe(
          "nafees@example.test"
        );
      })
  );
});

describe("MailerConfig reply-to", () => {
  it.effect("defaults to no reply-to when unset", () =>
    Effect.gen(function* () {
      const config = yield* loadMailerConfig({
        SMTP_REPLY_TO_ADDRESS: undefined,
      });

      expect(Option.isNone(config.replyTo)).toBe(true);
    })
  );

  it.effect("reads SMTP_REPLY_TO_ADDRESS when set", () =>
    Effect.gen(function* () {
      const config = yield* loadMailerConfig({
        SMTP_REPLY_TO_ADDRESS: "support@example.test",
      });

      expect(Option.getOrElse(config.replyTo, () => "unset")).toBe(
        "support@example.test"
      );
    })
  );

  it.effect("treats a blank SMTP_REPLY_TO_ADDRESS as unset", () =>
    Effect.gen(function* () {
      const config = yield* loadMailerConfig({
        SMTP_REPLY_TO_ADDRESS: "   ",
      });

      expect(Option.isNone(config.replyTo)).toBe(true);
    })
  );
});
