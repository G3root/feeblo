import { defineRule, eslintCompatPlugin } from "@oxlint/plugins";

/**
 * Every `Effect.run*` entry point. Tests should reach for `@effect/vitest`
 * instead, so the list is deliberately exhaustive rather than "the common
 * ones": a rule with holes teaches the wrong habit.
 */
const MANUAL_RUNTIME_METHODS = new Set([
  "runCallback",
  "runCallbackWith",
  "runFork",
  "runForkWith",
  "runPromise",
  "runPromiseExit",
  "runPromiseExitWith",
  "runPromiseWith",
  "runSync",
  "runSyncExit",
  "runSyncExitWith",
  "runSyncWith",
]);

/**
 * Names the manual runtime this call builds, or `undefined` when the callee is
 * unrelated. Only namespace access (`Effect.runPromise`) is matched, which is
 * the convention this repo uses.
 */
const manualRuntimeName = (callee: {
  readonly type: string;
  readonly object?: { readonly type: string; readonly name?: string };
  readonly property?: { readonly type: string; readonly name?: string };
}): string | undefined => {
  if (
    callee.type !== "MemberExpression" ||
    callee.object?.type !== "Identifier" ||
    callee.property?.type !== "Identifier"
  ) {
    return undefined;
  }
  const namespace = callee.object.name;
  const method = callee.property.name;
  if (namespace === "Effect" && method !== undefined) {
    return MANUAL_RUNTIME_METHODS.has(method) ? `Effect.${method}` : undefined;
  }
  if (namespace === "ManagedRuntime" && method === "make") {
    return "ManagedRuntime.make";
  }
  return undefined;
};

/**
 * Ban hand-built Effect runtimes in test files.
 *
 * `it.effect` and `it.layer` from `@effect/vitest` give every test a `Scope`,
 * the `TestClock`, and layer memoization, and they fail the test when the
 * Effect fails. A hand-run Effect loses all of that, and a forgotten `await`
 * on `Effect.runPromise` passes silently. Application entry points are the
 * only place a runtime is built by hand.
 *
 * The rule is enabled only for test files, by the `overrides` entry in
 * `oxlint.config.ts`. `createOnce` is called while the plugin loads, before
 * any file is known, so it cannot read `context.filename` to scope itself.
 */
export const noManualEffectRuntimeInTestsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow `Effect.run*` and `ManagedRuntime.make` in test files; use `@effect/vitest` so each test gets a Scope, the TestClock, and layer memoization.",
    },
    messages: {
      manualRuntime:
        "Do not run Effects by hand in tests. Use `it.effect` or `it.layer` from `@effect/vitest`; they provide a Scope, the TestClock, and layer memoization, and a failed Effect fails the test.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        // SAFETY: `ESLint` call nodes narrow to ESTree `CallExpression`, whose
        // callee is a `Node`; `manualRuntimeName` accepts the member shape and
        // returns undefined for every other node type.
        const callee = node.callee as {
          readonly type: string;
          readonly object?: { readonly type: string; readonly name?: string };
          readonly property?: { readonly type: string; readonly name?: string };
        };
        if (manualRuntimeName(callee) !== undefined) {
          context.report({ node: node.callee, messageId: "manualRuntime" });
        }
      },
    };
  },
});

/** Test-hygiene rules for this repo. */
const effectTestsPlugin = eslintCompatPlugin({
  meta: { name: "effect-tests" },
  rules: {
    "no-manual-effect-runtime-in-tests": noManualEffectRuntimeInTestsRule,
  },
});

export default effectTestsPlugin;
