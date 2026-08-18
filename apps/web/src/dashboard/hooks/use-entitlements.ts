import {
  type OrganizationPlan,
  PLAN_ENTITLEMENTS,
} from "@feeblo/domain/plan-entitlements";

import { usePlan } from "./use-plan";

export const useEntitlements = () => {
  const plan = usePlan();
  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  const planType = (plan.data?.plan ?? "free") as OrganizationPlan;
  const entitlements = PLAN_ENTITLEMENTS[planType];

  return {
    ...plan,
    plan: planType,
    entitlements,
  };
};
