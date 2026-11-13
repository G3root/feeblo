import { NodeServices } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";

import {
  Sandbox,
  SandboxError,
  SandboxToolFailure,
  type SandboxLimits,
} from "./sandbox";
import { NodeSandboxLive } from "./sandbox-node";

/**
 * The subprocess sandbox, driven through the production implementation.
 *
 * These are integration tests on purpose: what the sandbox promises is that a
 * separate process cannot see the host, and a fake spawner would prove the
 * protocol while leaving the isolation untested. Each test spawns the child the
 * route spawns, with the same permission flags.
 */

const SandboxLive = NodeSandboxLive.pipe(Layer.provide(NodeServices.layer));

/** A call that never runs, for a program that only returns a value. */
const noCalls = () => Effect.die("the program made an unexpected tool call");

/** Runs a program that is expected to fail, and returns the typed failure. */
const failureOf = (code: string, limits?: Partial<SandboxLimits>) =>
  Effect.gen(function* () {
    const sandbox = yield* Sandbox;
    return yield* sandbox
      .run({ call: noCalls, code, limits })
      .pipe(Effect.flip);
  });

layer(SandboxLive)("sandbox", (it) => {
  it.effect("returns the program's value and its logs", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const outcome = yield* sandbox.run({
        call: noCalls,
        code: 'console.log("hello", { a: 1 }); console.warn("careful"); return { ok: true };',
      });

      expect(outcome.result).toEqual({ ok: true });
      expect(outcome.logs).toEqual(['log: hello {"a":1}', "warn: careful"]);
      expect(outcome.calls).toEqual([]);
    })
  );

  it.effect(
    "round-trips a tool call and lets the program catch a refusal",
    () =>
      Effect.gen(function* () {
        const sandbox = yield* Sandbox;
        const outcome = yield* sandbox.run({
          call: ({ input, name }) =>
            name === "echo"
              ? Effect.succeed({ echoed: input })
              : Effect.fail(new SandboxToolFailure({ message: "boom" })),
          code: `
          const echoed = await tools.echo({ text: "hi" });
          try {
            await tools.explode({});
            return { echoed, message: "not caught" };
          } catch (error) {
            return { echoed, message: error.message };
          }
        `,
        });

        // The host's JSON is the program's JSON: no host object leaked through.
        expect(outcome.result).toEqual({
          echoed: { echoed: { text: "hi" } },
          message: "boom",
        });
        expect(outcome.calls).toEqual(["echo", "explode"]);
      })
  );

  it.effect("hides the host's globals and blocks generated code", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const outcome = yield* sandbox.run({
        call: noCalls,
        code: `
          const escape = (run) => {
            try {
              return "allowed: " + run();
            } catch (error) {
              return "blocked: " + error.name;
            }
          };
          return {
            constructor: escape(() => this.constructor.constructor("return process")()),
            eval: escape(() => eval("1 + 1")),
            function: escape(() => new Function("return 1")()),
            process: typeof process,
            require: typeof require,
            fetch: typeof fetch,
          };
        `,
      });

      expect(outcome.result).toEqual({
        constructor: "blocked: EvalError",
        eval: "blocked: EvalError",
        fetch: "undefined",
        function: "blocked: EvalError",
        process: "undefined",
        require: "undefined",
      });
    })
  );

  it.effect("reports a program that throws", () =>
    Effect.gen(function* () {
      const failure = yield* failureOf('throw new Error("nope")');

      expect(Schema.is(SandboxError)(failure)).toBe(true);
      if (!Schema.is(SandboxError)(failure)) return;
      expect(failure.code).toBe("CRASHED");
      expect(failure.message).toBe("nope");
    })
  );

  it.effect("stops a runaway loop at the evaluation budget", () =>
    Effect.gen(function* () {
      const failure = yield* failureOf("while (true) {}", {
        wallClockMs: 5_000,
      });

      expect(Schema.is(SandboxError)(failure)).toBe(true);
      if (!Schema.is(SandboxError)(failure)) return;
      expect(failure.code).toBe("CRASHED");
      expect(failure.message).toContain("timed out");
    })
  );

  it.effect("stops a program waiting on a tool at the wall clock", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;

      // `it.effect` runs on the `TestClock`, so the wall clock only passes when
      // the test advances it. The run is forked first and the clock advanced
      // once the timer is certainly armed; the program itself is genuinely
      // stuck, so nothing but the timeout can end it.
      const fiber = yield* sandbox
        .run({
          call: () => Effect.never,
          code: "return await tools.slow({});",
          limits: { wallClockMs: 200 },
        })
        .pipe(Effect.flip, Effect.forkChild);
      yield* TestClock.adjust("200 millis");
      const failure = yield* Fiber.join(fiber);

      expect(Schema.is(SandboxError)(failure)).toBe(true);
      if (!Schema.is(SandboxError)(failure)) return;
      expect(failure.code).toBe("LIMIT_EXCEEDED");
    })
  );

  it.effect("refuses a result larger than the budget", () =>
    Effect.gen(function* () {
      const failure = yield* failureOf('return "x".repeat(100);', {
        maxResultChars: 10,
      });

      expect(Schema.is(SandboxError)(failure)).toBe(true);
      if (!Schema.is(SandboxError)(failure)) return;
      expect(failure.code).toBe("LIMIT_EXCEEDED");
    })
  );

  it.effect("stops a program at its tool-call budget", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const outcome = yield* sandbox.run({
        call: ({ name }) => Effect.succeed({ called: name }),
        code: `
          await tools.one({});
          try {
            await tools.two({});
            return { message: "not stopped" };
          } catch (error) {
            return { message: error.message };
          }
        `,
        limits: { maxCalls: 1 },
      });

      expect(outcome.result).toEqual({
        message: "The program exceeded its tool-call budget.",
      });
      expect(outcome.calls).toEqual(["one"]);
    })
  );
});
