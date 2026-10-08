import { describe, expect, it } from "@effect/vitest";
import { AlreadyCanceledSubscription } from "@polar-sh/sdk/models/errors/alreadycanceledsubscription";
import { PolarError } from "@polar-sh/sdk/models/errors/polarerror";
import { ResourceNotFound } from "@polar-sh/sdk/models/errors/resourcenotfound";
import { SubscriptionLocked } from "@polar-sh/sdk/models/errors/subscriptionlocked";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  classifyPolarRevokeFailure,
  describeRevokeFailure,
  readOrganizationSubscriptionSettings,
} from "./service";

const httpMeta = (status: number) => ({
  body: "{}",
  request: new Request("https://api.polar.sh/v1/subscriptions/sub_test/revoke"),
  response: new Response(null, { status }),
});

describe("classifyPolarRevokeFailure", () => {
  it("treats Polar's already-canceled and missing-subscription answers as achieved", () => {
    const canceled = classifyPolarRevokeFailure(
      new AlreadyCanceledSubscription(
        {
          detail: "Subscription is already canceled",
          error: "AlreadyCanceledSubscription",
        },
        httpMeta(403)
      )
    );
    expect(canceled.alreadyRevoked).toBe(true);
    expect(canceled.statusCode).toBe(403);
    expect(canceled.errorTag).toBe("AlreadyCanceledSubscription");

    const missing = classifyPolarRevokeFailure(
      new ResourceNotFound(
        { detail: "Subscription not found", error: "ResourceNotFound" },
        httpMeta(404)
      )
    );
    expect(missing.alreadyRevoked).toBe(true);
    expect(missing.statusCode).toBe(404);
    expect(missing.errorTag).toBe("ResourceNotFound");
  });

  it("keeps other refusals and transport errors as failures", () => {
    expect(
      classifyPolarRevokeFailure(
        new SubscriptionLocked(
          {
            detail: "Subscription has a pending update",
            error: "SubscriptionLocked",
          },
          httpMeta(409)
        )
      )
    ).toEqual({
      alreadyRevoked: false,
      statusCode: 409,
      errorTag: "SubscriptionLocked",
    });

    expect(
      classifyPolarRevokeFailure(new PolarError("Server error", httpMeta(500)))
    ).toEqual({ alreadyRevoked: false, statusCode: 500 });

    // A 404 whose body is not the typed ResourceNotFound response must not
    // close a queue row: only the discriminant proves the subscription is
    // gone, and closing on a live one leaves it billing.
    expect(
      classifyPolarRevokeFailure(new PolarError("Not found", httpMeta(404)))
    ).toEqual({ alreadyRevoked: false, statusCode: 404 });

    expect(classifyPolarRevokeFailure(new Error("socket hang up"))).toEqual({
      alreadyRevoked: false,
    });
    expect(classifyPolarRevokeFailure({ statusCode: 403 })).toEqual({
      alreadyRevoked: false,
      statusCode: 403,
    });
    expect(classifyPolarRevokeFailure(undefined)).toEqual({
      alreadyRevoked: false,
    });
  });
});

describe("describeRevokeFailure", () => {
  it("names the Polar answer, or says there was none", () => {
    expect(
      describeRevokeFailure({
        alreadyRevoked: false,
        statusCode: 409,
        errorTag: "SubscriptionLocked",
      })
    ).toBe("Polar answered 409 SubscriptionLocked");

    expect(
      describeRevokeFailure({ alreadyRevoked: false, statusCode: 429 })
    ).toBe("Polar answered HTTP 429");

    expect(describeRevokeFailure({ alreadyRevoked: false })).toBe(
      "no Polar answer (transport error)"
    );
  });
});

describe("readOrganizationSubscriptionSettings", () => {
  it.effect("reads the token organization's settings", () =>
    Effect.gen(function* () {
      const settings = yield* readOrganizationSubscriptionSettings(() =>
        Promise.resolve({
          result: {
            items: [
              { subscriptionSettings: { allowMultipleSubscriptions: false } },
            ],
          },
        })
      );

      expect(Option.isSome(settings)).toBe(true);
      expect(Option.getOrThrow(settings).allowMultipleSubscriptions).toBe(
        false
      );
    })
  );

  it.effect("reads an empty organization list as no settings", () =>
    Effect.gen(function* () {
      const settings = yield* readOrganizationSubscriptionSettings(() =>
        Promise.resolve({ result: { items: [] } })
      );

      expect(Option.isNone(settings)).toBe(true);
    })
  );

  it.effect("reads a failed lookup as no settings", () =>
    Effect.gen(function* () {
      const settings = yield* readOrganizationSubscriptionSettings(() =>
        Promise.reject(new Error("Polar unreachable"))
      );

      expect(Option.isNone(settings)).toBe(true);
    })
  );
});
