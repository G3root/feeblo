import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  consumeDashboardRateLimit,
  RateLimitExceededError,
} from "./rate-limit";
import { RateLimitService } from "./rate-limit/service";

describe("consumeDashboardRateLimit", () => {
  it.effect("skips when the rate-limit layer is absent", () =>
    Effect.gen(function* () {
      // Handler unit tests run without RateLimitService; the helper must
      // succeed without enforcing rather than die on a missing service.
      yield* consumeDashboardRateLimit({
        key: "dashboard-rate-limit-test:o:u",
        name: "contact-search",
      });
    })
  );

  it.effect("enforces the limit when the layer is provided", () =>
    Effect.gen(function* () {
      const key = "dashboard-rate-limit-test:enforce";
      yield* consumeDashboardRateLimit({
        key,
        name: "contact-search",
        limit: 1,
      });
      const second = yield* Effect.flip(
        consumeDashboardRateLimit({ key, name: "contact-search", limit: 1 })
      );
      expect(second).toBeInstanceOf(RateLimitExceededError);
    }).pipe(Effect.provide(RateLimitService.layerMemory))
  );
});
