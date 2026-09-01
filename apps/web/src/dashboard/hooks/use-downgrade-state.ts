import { usePlan } from "./use-plan";

/**
 * Derived downgrade view of the current workspace plan: whether the free plan
 * still holds integration connections it can no longer use, and whether a paid
 * plan is scheduled to end. `null` until the plan query resolves.
 */
export const useDowngradeState = () => {
  const plan = usePlan();
  return plan.data?.downgradeState ?? null;
};
