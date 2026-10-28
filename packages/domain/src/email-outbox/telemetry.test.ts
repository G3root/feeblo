import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";

import { emailVolumeUsageRatio, recordEmailVolumeUsage } from "./telemetry";

const workspaceScope = Metric.withAttributes(emailVolumeUsageRatio, {
  scope: "workspace",
});

describe("email volume usage ratio", () => {
  it.effect("keeps a busy workspace visible after a quiet one reports", () =>
    Effect.gen(function* () {
      // Every workspace reports under the one `workspace` scope, so the order
      // of these two observations is the whole test: a gauge would end at 0.01
      // and the alert a busy workspace needs would never fire.
      yield* recordEmailVolumeUsage({
        limit: 100,
        scope: "workspace",
        used: 96,
      });
      yield* recordEmailVolumeUsage({
        limit: 100,
        scope: "workspace",
        used: 1,
      });

      const state = yield* Metric.value(workspaceScope);

      expect(state.count).toBe(2);
      expect(state.max).toBeCloseTo(0.96);
    })
  );

  it.effect("reads a spent allowance as fully used rather than infinite", () =>
    Effect.gen(function* () {
      yield* recordEmailVolumeUsage({
        limit: 0,
        scope: "platform",
        used: 0,
      });

      const state = yield* Metric.value(
        Metric.withAttributes(emailVolumeUsageRatio, { scope: "platform" })
      );

      expect(state.max).toBe(1);
    })
  );
});
