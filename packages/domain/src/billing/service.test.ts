import { describe, expect, it } from "@effect/vitest";
import { PolarClientError, PolarServerError } from "@polar-sh/sdk";
import { errors } from "@polar-sh/sdk/2026-10";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  classifyPolarRevokeFailure,
  describeRevokeFailure,
  readOrganizationSubscriptionSettings,
} from "./service";

describe("classifyPolarRevokeFailure", () => {
  it("treats Polar's already-canceled and missing-subscription answers as achieved", () => {
    const canceled = classifyPolarRevokeFailure(
      new errors.AlreadyCanceledSubscription(403, {
        detail: "Subscription is already canceled",
        error: "AlreadyCanceledSubscription",
      })
    );
    expect(canceled.alreadyRevoked).toBe(true);
    expect(canceled.statusCode).toBe(403);
    expect(canceled.errorTag).toBe("AlreadyCanceledSubscription");

    const missing = classifyPolarRevokeFailure(
      new errors.ResourceNotFound(404, {
        detail: "Subscription not found",
        error: "ResourceNotFound",
      })
    );
    expect(missing.alreadyRevoked).toBe(true);
    expect(missing.statusCode).toBe(404);
    expect(missing.errorTag).toBe("ResourceNotFound");
  });

  it("keeps other refusals and transport errors as failures", () => {
    expect(
      classifyPolarRevokeFailure(
        new errors.SubscriptionLocked(409, {
          detail: "Subscription has a pending update",
          error: "SubscriptionLocked",
        })
      )
    ).toEqual({
      alreadyRevoked: false,
      statusCode: 409,
      errorTag: "SubscriptionLocked",
    });

    expect(
      classifyPolarRevokeFailure(new PolarServerError(500, "Boom"))
    ).toEqual({ alreadyRevoked: false, statusCode: 500 });

    // A 404 whose body is not the typed ResourceNotFound response must not
    // close a queue row: only the discriminant proves the subscription is
    // gone, and closing on a live one leaves it billing. An unmapped status
    // arrives as a client error carrying the raw body text.
    expect(
      classifyPolarRevokeFailure(new PolarClientError(404, "Not found"))
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
          items: [
            { subscription_settings: { allow_multiple_subscriptions: false } },
          ],
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
        Promise.resolve({ items: [] })
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
