import { optionalString } from "@feeblo/config/effect";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class ProfanityCheckConfig extends Context.Service<ProfanityCheckConfig>()(
  "ProfanityCheckConfig",
  {
    make: Effect.gen(function* () {
      const apiUrl = yield* optionalString("PROFANITY_CHECK_API_URL");
      return { apiUrl } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
