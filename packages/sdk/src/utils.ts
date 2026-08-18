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

export function compact<T extends object>(obj: T) {
  const out: Record<string, CompactValue> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}
