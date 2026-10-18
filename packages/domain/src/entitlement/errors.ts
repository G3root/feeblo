import * as Schema from "effect/Schema";

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
    /** The `LimitFeatureKey` or capability that locked the resource. */
    feature: Schema.optional(Schema.String),
  },
  { httpApiStatus: 403, identifier: "PlanLockedError" }
) {}
