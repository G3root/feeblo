export const FEATURE_FLAGS = {
  DATA_IMPORT_EXPORT: false,
  // The audit log ships behind this switch: the table and the read surface
  // exist, and the recorder writes nothing until the flag is on.
  AUDIT_LOG: false,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export const isFeatureEnabled = (flag: FeatureFlag): boolean =>
  FEATURE_FLAGS[flag];
