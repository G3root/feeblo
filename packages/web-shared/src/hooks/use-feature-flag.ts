import { isFeatureEnabled, type FeatureFlag } from "@feeblo/domain/feature-flags";
import type { ReactNode } from "react";

export const useFeatureFlag = (flag: FeatureFlag): boolean => {
  return isFeatureEnabled(flag);
};

export function FeatureFlagGuard({
  flag,
  fallback = null,
  children,
}: {
  flag: FeatureFlag;
  fallback?: ReactNode;
  children: ReactNode;
}): ReactNode {
  const enabled = useFeatureFlag(flag);

  if (!enabled) {
    return fallback;
  }

  return children;
}
