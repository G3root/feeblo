import { describe, expect, it } from "vitest";

import {
  canTransitionIntegrationConnectionLifecycle,
  canTransitionIntegrationDeliveryState,
} from "./integration-lifecycle";

describe("integration lifecycle transitions", () => {
  it("permits documented connection transitions and rejects lifecycle skips", () => {
    expect(
      canTransitionIntegrationConnectionLifecycle({
        from: "active",
        to: "disconnecting",
      })
    ).toBe(true);
    expect(
      canTransitionIntegrationConnectionLifecycle({
        from: "active",
        to: "archived",
      })
    ).toBe(false);
  });

  it("allows manual retry only from exhausted and never revives canceled work", () => {
    expect(
      canTransitionIntegrationDeliveryState({
        from: "exhausted",
        to: "pending",
      })
    ).toBe(true);
    expect(
      canTransitionIntegrationDeliveryState({ from: "canceled", to: "pending" })
    ).toBe(false);
  });
});
