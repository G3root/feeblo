import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { MailerConfig } from "./config";

const loadMailerConfig = (
  environment: Record<string, string | undefined> = {}
) =>
  MailerConfig.pipe(
    Effect.provide(
      MailerConfig.layer.pipe(
        Layer.provide(
          ConfigProvider.layer(ConfigProvider.fromUnknown(environment))
        )
      )
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
