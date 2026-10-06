import * as Effect from "effect/Effect";

import { CompanyRepository } from "../company/repository";
import { EntitlementPolicy } from "../entitlement/policies";
import { withRemapDbErrors } from "../rpc-errors";
import {
  internalError,
  InternalError,
  planRequiresUpgradeError,
  PlanRequiresUpgradeError,
} from "./errors";

/**
 * What the room check can fail with, so a caller can name it without restating
 * the union — the company write takes the check as a parameter.
 */
export type CrmEntryAllowanceError = PlanRequiresUpgradeError | InternalError;

/**
 * The message for a workspace whose plan has no room left.
 *
 * Fixed rather than the policy's own `reason`: that one names the plan and the
 * limit, which is the dashboard's wording for a member looking at their own
 * billing, while this message is the only human-facing explanation a machine
 * key's operator gets and is part of the published contract's vocabulary.
 *
 * Exported because on-behalf attribution discovers the limit deep in identity
 * resolution rather than at the operation boundary, so the operation catches
 * `CrmEntryLimitReachedError` and has to report it in these words rather than
 * invent a second wording for the same limit.
 */
export const crmLimitMessage =
  "This workspace's plan has no room for another CRM entry.";

/**
 * Refuses a company create the workspace's plan has no room for.
 *
 * Companies and contacts count together as CRM entries, and the dashboard's own
 * create is gated on the same number. Without this the Public API would be a
 * way around a plan limit, and a limit that only one surface enforces is not a
 * limit — the two would drift the first time a plan gained a cap the dashboard
 * knew about and this API did not.
 *
 * No plan that can use the Public API has a CRM entry cap today: the cap is on
 * Free, and a Free workspace cannot create a key at all. So this is a guard
 * against that drift rather than a status a caller can reach right now, which
 * is why it is tested against the policy and the count directly instead of
 * through a request.
 *
 * Answered as `PLAN_REQUIRES_UPGRADE` rather than a code of its own: the remedy
 * is the same one — a plan with room — and a second 403 would publish a status
 * no reachable caller could trigger.
 *
 * The count it reads is only meaningful inside the write transaction that holds
 * the workspace lock, so callers run this there rather than on its own; the
 * company create takes it as a parameter for exactly that reason.
 */
export const requireCrmEntryAllowance = (
  organizationId: string
): Effect.Effect<
  void,
  CrmEntryAllowanceError,
  EntitlementPolicy | CompanyRepository
> =>
  Effect.gen(function* () {
    const policy = yield* EntitlementPolicy;
    const repository = yield* CompanyRepository;

    yield* policy
      .canCreateCrmEntry({
        organizationId,
        crmEntryCount: repository.countCrmEntries(organizationId),
      })
      .pipe(
        Effect.catchTag("PolicyDenied", () =>
          Effect.fail(planRequiresUpgradeError(crmLimitMessage))
        ),
        // The plan lookup and the count both read the database; a driver
        // failure is a server problem, not a plan problem.
        withRemapDbErrors("PublicApiPlan", "select"),
        Effect.catchTag("InternalServerError", () =>
          Effect.fail(internalError("The request could not be completed."))
        )
      );
  });
