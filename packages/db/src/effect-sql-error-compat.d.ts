/**
 * Drizzle's generated declarations reference `SqlError` through
 * `effect/unstable/sql/SqlError`, the module path Effect 4.0 used before the
 * `unstable` segment was dropped. The path does not exist in Effect 4.0, so
 * with `skipLibCheck` the import silently becomes `any` — and it is the error
 * half of `db.transaction`'s signature, which made every transaction in the
 * tree return `Effect<A, any, R>`. That `any` then flowed through every
 * repository and handler, so callers lost the errors they were supposed to
 * handle.
 *
 * Declaring the module here restores the real `SqlError` for the whole program.
 * Delete it when the pinned Drizzle release imports `effect/sql/SqlError`.
 */
declare module "effect/unstable/sql/SqlError" {
  export { SqlError } from "effect/sql/SqlError";
}
