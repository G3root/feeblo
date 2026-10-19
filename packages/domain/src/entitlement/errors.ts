import * as Schema from "effect/Schema";

import { PLAN_FEATURE_KEYS } from "../plan-entitlements";

/**
 * A write was refused because the resource is read-only under the plan lock.
 *
 * The dashboard maps this tag to the upgrade dialog; the message names the
 * feature so a stale UI (an open tab whose footer was rendered before the
 * downgrade) can explain why the action it just tried is no longer possible.
 * Distinct from `PolicyDenied` on purpose: permission denial means "ask
 * someone else", plan locking means "upgrade or free a slot", and the UI
 * routes those two to different actions.
 */
export class PlanLockedError extends Schema.TaggedError<PlanLockedError>()(
  "PlanLockedError",
  {
    message: Schema.optional(Schema.String),
    /**
     * The limit feature or capability that locked the resource.
     *
     * `PlanFeatureKey` rather than a free string: the surface that reads it
     * maps a feature to the remedy it offers, and a feature the code does not
     * know about should not compile past that mapping.
     */
    feature: Schema.optional(Schema.Literals(PLAN_FEATURE_KEYS)),
  },
  { httpApiStatus: 403, identifier: "PlanLockedError" }
) {}
