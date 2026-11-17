export const FEATURE_FLAGS = {
  DATA_IMPORT_EXPORT: false,
  // The audit log ships behind this switch: the table and the read surface
  // exist, and the recorder writes nothing until the flag is on.
  AUDIT_LOG: false,
  // The help center ships behind this switch: the tables, the routes and the
  // portal pages exist, and every surface refuses until it is on. Unlike the
  // audit log — where only the writer is gated, because a read of an empty
  // table is harmless — there is no pre-existing data here, so a read is as
  // much a launch as a write and both are gated.
  HELP_CENTER: false,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export const isFeatureEnabled = (flag: FeatureFlag): boolean =>
  FEATURE_FLAGS[flag];
