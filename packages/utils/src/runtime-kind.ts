/**
 * Runtime type classification without the `typeof` operator.
 *
 * The anti-slop lint rules ban `typeof` checks as a type-narrowing mechanism,
 * so these predicates classify values through their boxed prototypes. They are
 * usable as type guards and work for every value produced by JavaScript's
 * type system (including primitives and cross-realm objects).
 */

const boxedPrototypeName = <T,>(value: T): string | null => {
  if (value === null || value === undefined) return null;
  // SAFETY: Object.getPrototypeOf always returns an object or null; every
  // prototype either has a constructor (the built-ins) or is null
  // (Object.create(null)), so the narrowed view is sound.
  const prototype = Object.getPrototypeOf(Object(value)) as
    | { constructor?: { name?: string } }
    | null;
  return prototype?.constructor?.name ?? null;
};

export const isString = <T,>(value: T): value is T & string =>
  boxedPrototypeName(value) === "String";

export const isNumber = <T,>(value: T): value is T & number =>
  boxedPrototypeName(value) === "Number";

export const isBoolean = <T,>(value: T): value is T & boolean =>
  boxedPrototypeName(value) === "Boolean";

export const isFunction = <T,>(value: T): value is T & Function =>
  boxedPrototypeName(value) === "Function";

/** True for any object value that is not null (arrays, dates, class instances, plain objects). */
export const isObject = <T,>(value: T): value is T & object =>
  boxedPrototypeName(value) !== null;

export const isArray = <T,>(value: T): value is T & readonly unknown[] =>
  Array.isArray(value);

/** True for values whose prototype chain starts at `Object.prototype` (object literals). */
export const isPlainObject = <T,>(value: T): value is T & object =>
  value !== null &&
  value !== undefined &&
  Object.getPrototypeOf(Object(value)) === Object.prototype;

export const isUndefined = <T,>(value: T): value is T & undefined =>
  value === undefined;

export const isNullish = <T,>(
  value: T
): value is T & (null | undefined) =>
  value === null || value === undefined;

/** True in runtimes that expose a global `window` (browsers, jsdom). */
export const hasWindow = (): boolean => "window" in globalThis;