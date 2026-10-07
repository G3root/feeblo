import { AlreadyCanceledSubscription } from "@polar-sh/sdk/models/errors/alreadycanceledsubscription";
import { PolarError } from "@polar-sh/sdk/models/errors/polarerror";
import { ResourceNotFound } from "@polar-sh/sdk/models/errors/resourcenotfound";
import { describe, expect, it } from "vitest";

import { isPolarSubscriptionAlreadyRevoked } from "./service";

const httpMeta = (status: number) => ({
  body: "{}",
  request: new Request("https://api.polar.sh/v1/subscriptions/sub_test/revoke"),
  response: new Response(null, { status }),
});

describe("isPolarSubscriptionAlreadyRevoked", () => {
  it("treats Polar's already-canceled and missing-subscription answers as achieved", () => {
    expect(
      isPolarSubscriptionAlreadyRevoked(
        new AlreadyCanceledSubscription(
          {
            detail: "Subscription is already canceled",
            error: "AlreadyCanceledSubscription",
          },
          httpMeta(403)
        )
      )
    ).toBe(true);

    expect(
      isPolarSubscriptionAlreadyRevoked(
        new ResourceNotFound(
          { detail: "Subscription not found", error: "ResourceNotFound" },
          httpMeta(404)
        )
      )
    ).toBe(true);
  });

  it("keeps other refusals and transport errors as failures", () => {
    expect(
      isPolarSubscriptionAlreadyRevoked(
        new PolarError("Server error", httpMeta(500))
      )
    ).toBe(false);
    expect(isPolarSubscriptionAlreadyRevoked(new Error("socket hang up"))).toBe(
      false
    );
    expect(isPolarSubscriptionAlreadyRevoked({ statusCode: 403 })).toBe(false);
    expect(isPolarSubscriptionAlreadyRevoked(undefined)).toBe(false);
  });
});
