import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  DEFAULT_SANDBOX_LIMITS,
  Sandbox,
  SandboxError,
  type SandboxLimits,
  type SandboxOutcome,
  type SandboxProgram,
} from "./sandbox";

/**
 * The Node subprocess implementation of `Sandbox`.
 *
 * A separate process with Node's permission model on, no file system grants, no
 * network grant, and no child-process grant. The program itself is compiled by
 * `node:vm` inside that process with code generation from strings disabled, so
 * `eval`, `new Function`, and the `this.constructor.constructor` escape all
 * throw, and `process`, `require`, and `fetch` are not in its global object.
 *
 * The parent talks to the child over newline-delimited JSON on stdin/stdout:
 * the parent sends the program, the child answers each `tools.<name>(input)`
 * with a `call`, and the parent answers with the decoded result or a tool
 * failure. The child is killed when its scope closes, so a request that is
 * interrupted, a wall clock that expires, or a dead parent cannot leave a
 * program running.
 *
 * The runner source is a constant string rather than a file: `--permission`
 * refuses to read the entry script's own path, and a fixed program in argv
 * keeps the child's argv identical for every run, which is easier to audit than
 * a temp file per request.
 */

/**
 * The child's side of the protocol.
 *
 * Kept free of template placeholders: everything it needs arrives in the
 * program message, so this string is the same for every run and there is no
 * interpolation to escape.
 */
const RUNNER_SOURCE = String.raw`
import { createInterface } from "node:readline";
import { createContext, Script } from "node:vm";

const parentPid = process.ppid;
const exitIfOrphaned = () => {
  if (process.ppid === 1 || process.ppid !== parentPid) process.exit(1);
};
exitIfOrphaned();
setInterval(exitIfOrphaned, 250).unref();

const logs = [];
const pending = new Map();
let nextId = 0;
let calls = 0;
let maxCalls = 100;
let maxLogs = 200;

const send = (message) => {
  process.stdout.write(JSON.stringify(message) + "\n");
};

const log = (level, args) => {
  if (logs.length >= maxLogs) return;
  logs.push(
    level +
      ": " +
      args
        .map((value) => {
          if (typeof value === "string") return value;
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })
        .join(" ")
  );
};

const callTool = (name, input) =>
  new Promise((resolve, reject) => {
    if (calls >= maxCalls) {
      reject(new Error("The program exceeded its tool-call budget."));
      return;
    }
    calls += 1;
    const id = nextId++;
    pending.set(id, { reject, resolve });
    send({ type: "call", id, name, input: input === undefined ? {} : input });
  });

const start = (message) => {
  const code = typeof message.code === "string" ? message.code : "";
  const evaluationMs =
    typeof message.evaluationMs === "number" ? message.evaluationMs : 1000;
  maxCalls = typeof message.maxCalls === "number" ? message.maxCalls : maxCalls;
  maxLogs = typeof message.maxLogs === "number" ? message.maxLogs : maxLogs;

  const context = createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });
  context.console = {
    debug: (...args) => log("debug", args),
    error: (...args) => log("error", args),
    info: (...args) => log("info", args),
    log: (...args) => log("log", args),
    warn: (...args) => log("warn", args),
  };
  context.tools = new Proxy(Object.create(null), {
    get: (_target, property) => {
      if (typeof property !== "string") return undefined;
      return (input) => callTool(property, input);
    },
  });

  const script = new Script("(async () => {\n" + code + "\n})()", {
    filename: "program.js",
  });
  let evaluation;
  try {
    evaluation = script.runInContext(context, { timeout: evaluationMs });
  } catch (error) {
    send({
      logs,
      message:
        error && typeof error.message === "string"
          ? error.message
          : "The program did not finish evaluating.",
      type: "error",
    });
    process.exit(0);
  }

  Promise.resolve(evaluation).then(
    (value) => {
      let result;
      try {
        result = JSON.stringify(value === undefined ? null : value);
      } catch {
        send({
          logs,
          message: "The program's result is not representable as JSON.",
          type: "error",
        });
        process.exit(0);
      }
      send({ logs, result, type: "done" });
      process.exit(0);
    },
    (error) => {
      send({
        logs,
        message:
          error && typeof error.message === "string"
            ? error.message
            : "The program failed.",
        type: "error",
      });
      process.exit(0);
    }
  );
};

const connection = createInterface({ input: process.stdin });
let started = false;
connection.on("line", (text) => {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    process.exit(1);
  }
  if (!started) {
    started = true;
    start(message);
    return;
  }
  if (message.type !== "result") return;
  const entry = pending.get(message.id);
  if (entry === undefined) return;
  pending.delete(message.id);
  if (message.ok === true) entry.resolve(message.value);
  else {
    entry.reject(
      new Error(
        typeof message.error === "string"
          ? message.error
          : "The tool call failed."
      )
    );
  }
});
connection.on("close", () => process.exit(1));
connection.on("end", () => process.exit(1));

`;

/** The child's `tools.<name>(input)` request, decoded strictly. */
const CallMessage = Schema.Struct({
  id: Schema.Finite,
  input: Schema.Json,
  name: Schema.String,
  type: Schema.Literal("call"),
});

/** The child's successful answer, already serialized so a cycle fails there. */
const DoneMessage = Schema.Struct({
  logs: Schema.Array(Schema.String),
  result: Schema.String,
  type: Schema.Literal("done"),
});

/** The child's failed answer: the program threw, or produced no JSON. */
const ErrorMessage = Schema.Struct({
  logs: Schema.Array(Schema.String),
  message: Schema.String,
  type: Schema.Literal("error"),
});

const ChildMessage = Schema.fromJsonString(
  Schema.Union([CallMessage, DoneMessage, ErrorMessage])
);

const decodeChildMessage = Schema.decodeUnknownOption(ChildMessage);

const JsonString = Schema.fromJsonString(Schema.Json);

const decodeResult = Schema.decodeUnknownOption(JsonString);

/**
 * The messages the parent writes to the child.
 *
 * Named rather than `unknown`: the protocol is three shapes, and typing the
 * writer is what turns a misspelled field into a compile error instead of a
 * child that waits forever.
 */
type HostMessage =
  | {
      readonly type: "program";
      readonly code: string;
      readonly evaluationMs: number;
      readonly maxCalls: number;
      readonly maxLogs: number;
    }
  | {
      readonly type: "result";
      readonly id: number;
      readonly ok: true;
      readonly value: Schema.Json;
    }
  | {
      readonly type: "result";
      readonly id: number;
      readonly ok: false;
      readonly error: string;
    };

const encodeLine = (message: HostMessage) => `${JSON.stringify(message)}\n`;

const crash = (message: string) =>
  new SandboxError({ code: "CRASHED", message });

const limitExceeded = (message: string) =>
  new SandboxError({ code: "LIMIT_EXCEEDED", message });

export const NodeSandboxLive = Layer.effect(
  Sandbox,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const run = Effect.fn("NodeSandbox.run")(function* (
      program: SandboxProgram
    ) {
      const limits: SandboxLimits = {
        ...DEFAULT_SANDBOX_LIMITS,
        ...program.limits,
      };

      return yield* Effect.scoped(
        Effect.gen(function* () {
          const child = yield* spawner.spawn(
            // A fixed argv, a fresh interpreter per request, and the permission
            // model on: the child cannot read a file, spawn a process, spawn a
            // worker, add a native addon, or open a socket.
            ChildProcess.make(process.execPath, [
              "--permission",
              "--input-type=module",
              "--no-warnings",
              "-e",
              RUNNER_SOURCE,
            ])
          );
          yield* Effect.addFinalizer(() => child.kill().pipe(Effect.ignore));

          const input = yield* Queue.unbounded<Uint8Array>();
          yield* Stream.fromQueue(input).pipe(
            Stream.run(child.stdin),
            Effect.forkScoped
          );

          const encoder = new TextEncoder();
          const write = (message: HostMessage) =>
            Queue.offer(input, encoder.encode(encodeLine(message)));

          const state = yield* Ref.make<Option.Option<SandboxOutcome>>(
            Option.none()
          );
          const calls = yield* Ref.make<ReadonlyArray<string>>([]);
          const callCount = yield* Ref.make(0);

          const handleCall = (message: typeof CallMessage.Type) =>
            Effect.gen(function* () {
              if ((yield* Ref.get(callCount)) >= limits.maxCalls) {
                return yield* limitExceeded(
                  "The program exceeded its tool-call budget."
                );
              }
              yield* Ref.update(callCount, (count) => count + 1);
              yield* Ref.update(calls, (names) => [...names, message.name]);

              const answer = yield* program
                .call({ input: message.input, name: message.name })
                .pipe(
                  Effect.map((value) => ({ ok: true as const, value })),
                  Effect.catch((failure) =>
                    Effect.succeed({
                      error: failure.message,
                      ok: false as const,
                    })
                  )
                );

              yield* write({ id: message.id, type: "result", ...answer });
            });

          const handleDone = (message: typeof DoneMessage.Type) =>
            Effect.gen(function* () {
              if (message.result.length > limits.maxResultChars) {
                return yield* limitExceeded(
                  `The program's result is larger than ${limits.maxResultChars} characters.`
                );
              }
              const result = yield* Effect.fromOption(
                decodeResult(message.result),
                () =>
                  new SandboxError({
                    code: "UNREPRESENTABLE_RESULT",
                    message: "The program's result is not JSON.",
                  })
              );
              const called = yield* Ref.get(calls);
              yield* Ref.set(
                state,
                Option.some({ calls: called, logs: message.logs, result })
              );
            });

          const handle = Effect.fnUntraced(function* (line: string) {
            const message = decodeChildMessage(line);
            if (Option.isNone(message)) {
              return yield* crash(
                "The sandbox wrote a message it cannot mean."
              );
            }
            switch (message.value.type) {
              case "call":
                return yield* handleCall(message.value);
              case "done":
                return yield* handleDone(message.value);
              case "error":
                return yield* crash(message.value.message);
            }
          });

          yield* write({
            code: program.code,
            evaluationMs: limits.evaluationMs,
            maxCalls: limits.maxCalls,
            maxLogs: limits.maxLogs,
            type: "program",
          });

          const pump = child.stdout.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.filter((line) => line.length > 0),
            Stream.runForEach(handle)
          );

          const outcome = yield* Effect.andThen(
            // The wall clock includes every tool call the program awaited, not
            // only its own compute: a program that spends its budget on calls
            // it did not need is the failure this bounds.
            Effect.timeoutOrElse(pump, {
              duration: Duration.millis(limits.wallClockMs),
              orElse: () =>
                child
                  .kill()
                  .pipe(
                    Effect.andThen(
                      limitExceeded(
                        `The program exceeded its ${limits.wallClockMs} ms budget.`
                      )
                    )
                  ),
            }),
            Ref.get(state)
          );

          if (Option.isNone(outcome)) {
            return yield* crash("The program ended without returning a value.");
          }
          return outcome.value;
        })
      ).pipe(
        // A spawner failure is the host's problem, not the program's: the
        // caller still reads one typed failure, and one tag to switch on.
        Effect.catchTag("PlatformError", (error) =>
          Effect.fail(crash(`The sandbox could not run: ${error.message}`))
        )
      );
    });

    return Sandbox.of({ run });
  })
);
