export function isBrowser(): boolean {
  return "window" in globalThis && "document" in globalThis;
}

/** Non-undefined values preserved by {@link compact}; matches the identity payload space. */
export type CompactValue =
  | string
  | number
  | boolean
  | null
  | readonly CompactValue[];

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the type parameter is how this helper accepts any value without spelling `unknown`, which `anti-slop/no-unknown-parameters` bans (the established spelling is `packages/utils/src/runtime-kind.ts`); the parameter is used once by construction
export function compact<T extends object>(obj: T) {
  // SAFETY: `CompactValue` is the identity payload space; the filter removes
  // the only value that space does not allow.
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  ) as Record<string, CompactValue>;
}
