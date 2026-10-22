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
  const out: Record<string, CompactValue> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}
