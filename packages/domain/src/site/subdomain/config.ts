import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

const parseWords = (value: Option.Option<string>): string[] =>
  Option.getOrElse(value, () => "")
    .split(",")
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 0);

export class ProfanityConfig extends Context.Service<ProfanityConfig>()(
  "ProfanityConfig",
  {
    make: Effect.gen(function* () {
      const customWords = yield* Config.string("PROFANITY_WORDS").pipe(
        Config.option
      );
      const extraWords = yield* Config.string("PROFANITY_EXTRA_WORDS").pipe(
        Config.option
      );

      return {
        /** When non-empty, replaces the bundled dictionary entirely. */
        customWords: parseWords(customWords),
        /** Appended to the bundled dictionary. */
        extraWords: parseWords(extraWords),
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
