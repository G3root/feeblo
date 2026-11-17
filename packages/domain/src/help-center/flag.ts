import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import { isFeatureEnabled } from "../feature-flags";
import type { PublicPolicy } from "../policy";
import { PolicyDeniedError } from "../policy";

/**
 * Whether the help center is switched on for this process.
 *
 * A `Context.Reference` rather than a direct `isFeatureEnabled` read, so a test
 * can exercise the handlers while the product default stays off:
 * `HELP_CENTER` in `feature-flags.ts` is only the default it falls back to.
 * Same shape as `audit-log/flag.ts`, for the same reason.
 */
export class HelpCenterEnabled extends Context.Reference<boolean>(
  "@feeblo/domain/help-center/HelpCenterEnabled",
  { defaultValue: () => isFeatureEnabled("HELP_CENTER") }
) {}

/**
 * The gate every help center operation is piped through.
 *
 * A **public** policy, not a session policy, because the portal's operations
 * have no session to check: the flag is the only thing that matters to them.
 * Failing with `PolicyDeniedError` is deliberate — every one of the three
 * modules already declares that error, so the feature being off needs no new
 * vocabulary at the RPC boundary, and "not enabled" is exactly the kind of
 * refusal a policy expresses.
 *
 * The gate is applied **last** in each handler's pipe, which makes it the
 * outermost check: a deployment with the feature off refuses before it reads a
 * row or spends a rate-limit token on an operation nobody can use.
 */
export const helpCenterFeatureGate: PublicPolicy = Effect.gen(function* () {
  const enabled = yield* HelpCenterEnabled;

  if (!enabled) {
    return yield* new PolicyDeniedError({
      reason: "The help center is not enabled for this deployment.",
    });
  }
});
