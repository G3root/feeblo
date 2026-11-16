import { NodeServices } from "@effect/platform-node";
import { expect, layer } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
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

  it.effect("answers a tool call that dies with a failure frame", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const outcome = yield* sandbox.run({
        // A defect is not a typed refusal; without a recovery it kills the
        // forked call and the child waits for an answer that never comes.
        call: () => Effect.die("boom"),
        code: `
          try {
            await tools.explode({});
            return { message: "not caught" };
          } catch (error) {
            return { message: error.message };
          }
        `,
      });

      expect(outcome.result).toEqual({
        message: 'The tool call "explode" failed unexpectedly.',
      });
      expect(outcome.calls).toEqual(["explode"]);
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
            bridge: typeof __sandbox,
            console: escape(() => console.log.constructor("return process")()),
            constructor: escape(() => this.constructor.constructor("return process")()),
            eval: escape(() => eval("1 + 1")),
            fetch: typeof fetch,
            function: escape(() => new Function("return 1")()),
            process: typeof process,
            require: typeof require,
            tools: escape(() => tools.echo.constructor("return process")()),
          };
        `,
      });

      expect(outcome.result).toEqual({
        bridge: "undefined",
        console: "blocked: EvalError",
        constructor: "blocked: EvalError",
        eval: "blocked: EvalError",
        fetch: "undefined",
        function: "blocked: EvalError",
        process: "undefined",
        require: "undefined",
        tools: "blocked: EvalError",
      });
    })
  );

  it.effect(
    "settles through captured intrinsics, not program-replaceable ones",
    () =>
      Effect.gen(function* () {
        const sandbox = yield* Sandbox;
        const outcome = yield* sandbox.run({
          call: noCalls,
          code: `
          let escape = "not called";
          // A host-side settlement called this with the host's resolve and
          // reject functions; capturing them was the escape, and calling the
          // host's resolve kept the sandbox answering while it happened.
          Promise.prototype.then = function (onFulfilled) {
            try {
              escape = "allowed: " + onFulfilled.constructor("return process.version")();
            } catch (error) {
              escape = "blocked: " + error.name;
            }
            onFulfilled({ escape });
            return undefined;
          };
          return { escape };
        `,
        });

        // Settlement used the realm's captured intrinsic, so the override ran
        // nowhere and the result is the program's own return value.
        expect(outcome.result).toEqual({ escape: "not called" });
      })
  );

  it.effect("encodes the result with the captured JSON.stringify", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const outcome = yield* sandbox.run({
        call: noCalls,
        // A replaced stringify would hijack every message the realm sends if
        // the bridge looked it up at call time.
        code: 'JSON.stringify = () => "hijacked"; return { ok: true };',
      });

      expect(outcome.result).toEqual({ ok: true });
    })
  );

  it.effect("refuses a frame larger than the protocol allows", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const failure = yield* sandbox
        .run({
          call: noCalls,
          code: 'return "x".repeat(2_000_000);',
          // The result cap is raised so the frame bound is what refuses it.
          limits: { maxResultChars: 5_000_000 },
        })
        .pipe(Effect.flip);

      expect(Schema.is(SandboxError)(failure)).toBe(true);
      if (!Schema.is(SandboxError)(failure)) return;
      expect(failure.code).toBe("LIMIT_EXCEEDED");
      expect(failure.message).toContain("frame larger");
    })
  );

  it.effect("stops a program at the memory watchdog", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const failure = yield* sandbox
        .run({
          // The program waits on a call that never answers, so the watchdog
          // — not the wall clock — is what ends it.
          call: () => Effect.never,
          code: "return await tools.slow({});",
          limits: { maxRssBytes: 1, wallClockMs: 5_000 },
        })
        .pipe(Effect.flip);

      expect(Schema.is(SandboxError)(failure)).toBe(true);
      if (!Schema.is(SandboxError)(failure)) return;
      expect(failure.code).toBe("LIMIT_EXCEEDED");
      expect(failure.message).toContain("memory budget");
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
      const called = yield* Deferred.make<void>();

      // `it.effect` runs on the `TestClock`, so the wall clock only passes
      // when the test advances it. The handshake makes sure the run is live
      // and the clock is armed before the advance; the program itself is
      // genuinely stuck, so nothing but the timeout can end it.
      const fiber = yield* sandbox
        .run({
          call: () =>
            Deferred.succeed(called, undefined).pipe(
              Effect.andThen(Effect.never)
            ),
          code: "return await tools.slow({});",
          limits: { wallClockMs: 200 },
        })
        .pipe(Effect.flip, Effect.forkChild);
      yield* Deferred.await(called);
      yield* TestClock.adjust("200 millis");
      const failure = yield* Fiber.join(fiber);

      expect(Schema.is(SandboxError)(failure)).toBe(true);
      if (!Schema.is(SandboxError)(failure)) return;
      expect(failure.code).toBe("LIMIT_EXCEEDED");
    })
  );

  it.effect("stops a program that starves the child's own event loop", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const called = yield* Deferred.make<void>();

      // The program calls once, then keeps resolving promises, so the child's
      // event loop never processes the signal handler a graceful kill would
      // rely on; only the forced kill ends it.
      const fiber = yield* sandbox
        .run({
          call: () => Deferred.succeed(called, undefined).pipe(Effect.as({})),
          code: `
            await tools.ready({});
            for (;;) { await Promise.resolve(); }
          `,
          limits: { wallClockMs: 200 },
        })
        .pipe(Effect.flip, Effect.forkChild);
      yield* Deferred.await(called);
      yield* TestClock.adjust("200 millis");
      const failure = yield* Fiber.join(fiber);

      expect(Schema.is(SandboxError)(failure)).toBe(true);
      if (!Schema.is(SandboxError)(failure)) return;
      expect(failure.code).toBe("LIMIT_EXCEEDED");
    })
  );

  it.effect("does not charge a wait on a person to the wall clock", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const waiting = yield* Deferred.make<void>();

      const fiber = yield* sandbox
        .run({
          call: (_call, controls) =>
            controls.waitForPerson(
              Deferred.succeed(waiting, undefined).pipe(
                Effect.andThen(Effect.sleep("5 seconds")),
                Effect.as({ approved: true })
              )
            ),
          code: "return await tools.approve({});",
          limits: { wallClockMs: 200 },
        })
        .pipe(Effect.forkChild);

      // The hold is taken before the effect runs, so once the test sees this
      // the clock is paused and the 5 s sleep cannot spend the 200 ms budget.
      yield* Deferred.await(waiting);
      yield* TestClock.adjust("5 seconds");

      const outcome = yield* Fiber.join(fiber);
      expect(outcome.result).toEqual({ approved: true });
    })
  );

  it.effect("charges a wait on a person only for the time it held", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const approving = yield* Deferred.make<void>();
      const working = yield* Deferred.make<void>();

      // 350 ms of wall time against a 200 ms budget: 150 ms waiting on a
      // person, then 200 ms executing. The wait is excluded for exactly its
      // own interval, so the run still answers; charging the tick the wait
      // ended in would have spent the budget before the program got there.
      const fiber = yield* sandbox
        .run({
          call: (call, controls) =>
            call.name === "approve"
              ? controls
                  .waitForPerson(
                    Deferred.succeed(approving, undefined).pipe(
                      Effect.andThen(Effect.sleep("150 millis"))
                    )
                  )
                  .pipe(Effect.as({ approved: true }))
              : Deferred.succeed(working, undefined).pipe(
                  Effect.andThen(Effect.sleep("200 millis")),
                  Effect.as({ slow: true })
                ),
          code: `
            await tools.approve({});
            return await tools.slow({});
          `,
          limits: { wallClockMs: 200 },
        })
        .pipe(Effect.forkChild);

      yield* Deferred.await(approving);
      yield* TestClock.adjust("150 millis");
      yield* Deferred.await(working);
      yield* TestClock.adjust("200 millis");

      const outcome = yield* Fiber.join(fiber);
      expect(outcome.result).toEqual({ slow: true });
    })
  );

  it.effect("stops a program whose wait on a person outlives the limit", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox;
      const waiting = yield* Deferred.make<void>();

      // A wait is excluded from the execution budget, not from every bound: a
      // run waiting on a person still holds its permit and its child keeps
      // running, so an answer that never comes ends the run instead.
      const fiber = yield* sandbox
        .run({
          call: (_call, controls) =>
            controls.waitForPerson(
              Deferred.succeed(waiting, undefined).pipe(
                Effect.andThen(Effect.sleep("5 minutes")),
                Effect.as({ approved: true })
              )
            ),
          code: "return await tools.approve({});",
          limits: { maxApprovalWaitMs: 1_000, wallClockMs: 200 },
        })
        .pipe(Effect.flip, Effect.forkChild);

      yield* Deferred.await(waiting);
      yield* TestClock.adjust("5 minutes");

      const failure = yield* Fiber.join(fiber);
      expect(Schema.is(SandboxError)(failure)).toBe(true);
      if (!Schema.is(SandboxError)(failure)) return;
      expect(failure.code).toBe("LIMIT_EXCEEDED");
      expect(failure.message).toContain("for a person");
    })
  );

  it.effect(
    "bounds a program that keeps working while an approval is pending",
    () =>
      Effect.gen(function* () {
        const sandbox = yield* Sandbox;
        const waiting = yield* Deferred.make<void>();

        // The program starts an approval but keeps the child working instead
        // of waiting for the answer itself. Excluding the approval from the
        // wall clock must not turn into a second deadline-free budget: the run
        // still holds its permit, so the approval limit ends it.
        const fiber = yield* sandbox
          .run({
            call: (call, controls) =>
              call.name === "approve"
                ? controls.waitForPerson(
                    Deferred.succeed(waiting, undefined).pipe(
                      Effect.andThen(Effect.never)
                    )
                  )
                : Effect.succeed({}),
            code: `
            tools.approve({});
            for (;;) { await tools.tick({}); }
          `,
            limits: {
              maxApprovalWaitMs: 300,
              maxCalls: 1_000_000,
              wallClockMs: 10_000,
            },
          })
          .pipe(Effect.flip, Effect.forkChild);

        yield* Deferred.await(waiting);
        yield* TestClock.adjust("300 millis");

        const failure = yield* Fiber.join(fiber);
        expect(Schema.is(SandboxError)(failure)).toBe(true);
        if (!Schema.is(SandboxError)(failure)) return;
        expect(failure.code).toBe("LIMIT_EXCEEDED");
        expect(failure.message).toContain("for a person");
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
