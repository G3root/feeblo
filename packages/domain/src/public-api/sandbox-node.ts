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
 * network grant, and no child-process grant, started with an empty environment
 * so nothing in the server's `process.env` — `NODE_OPTIONS` included — reaches
 * it.
 *
 * The program itself is compiled by `node:vm` inside that process with code
 * generation from strings disabled, and **every function it can reach is
 * created inside the sandbox's realm**. That last part is what makes the vm a
 * boundary at all: `console.log` and `tools.<name>` are realm functions, not
 * host callbacks, so the classic `console.log.constructor("return process")()`
 * escape resolves the *realm's* `Function` constructor and is refused by
 * `codeGeneration: { strings: false }`. JSON strings and primitives are the
 * only values that cross either way: the host hands the program its code and
 * its tool results as strings, and the realm answers with JSON strings for
 * calls, logs, and settlement. The host never adopts the program's promise
 * with its own `then` — settlement uses promise intrinsics captured before the
 * program runs — because that would pass host functions into the realm and
 * read a property the program can replace.
 *
 * The parent talks to the child over newline-delimited JSON on stdin/stdout:
 * the parent sends the program, the child answers each `tools.<name>(input)`
 * with a `call`, and the parent answers with the decoded result or a tool
 * failure. Every frame the child writes is bounded before it is decoded, so a
 * result or log line cannot make the parent buffer an unbounded line. The child
 * is killed when its scope closes, and its wall clock is enforced by the
 * parent, so an interrupted request, an expired budget, or a dead parent cannot
 * leave a program running.
 *
 * The runner source is a constant string rather than a file: `--permission`
 * refuses to read the entry script's own path, and a fixed program in argv
 * keeps the child's argv identical for every run, which is easier to audit than
 * a temp file per request.
 */

/**
 * The largest frame the child may write, in characters of the decoded line.
 *
 * A frame is one protocol message. The bound sits before `JSON.parse`, and the
 * partial line a chunk leaves behind is checked after every chunk, so a child
 * that writes one enormous line is refused instead of buffered. A tool call's
 * input is checked against the same bound inside the realm, where it can be
 * told to the program as a caught error.
 */
const MAX_FRAME_CHARS = 1_048_576;

/**
 * The child's side of the protocol.
 *
 * Kept free of template placeholders: everything it needs arrives in the
 * program message, so this string is the same for every run and there is no
 * interpolation to escape.
 */
const RUNNER_SOURCE = String.raw`
import { createInterface } from "node:readline";
import { createContext, runInContext, Script } from "node:vm";

const parentPid = process.ppid;
const exitIfOrphaned = () => {
  if (process.ppid === 1 || process.ppid !== parentPid) process.exit(1);
};
exitIfOrphaned();
setInterval(exitIfOrphaned, 250).unref();

const BOOTSTRAP = [
  "(() => {",
  "const maxLogs = __sandboxMaxLogs;",
  "const maxCalls = __sandboxMaxCalls;",
  "const maxFrameChars = __sandboxMaxFrameChars;",
  "delete globalThis.__sandboxMaxLogs;",
  "delete globalThis.__sandboxMaxCalls;",
  "delete globalThis.__sandboxMaxFrameChars;",
  "const promiseThen = Promise.prototype.then;",
  "const reflectApply = Reflect.apply;",
  "const jsonStringify = JSON.stringify;",
  "const logLines = [];",
  "const format = (value) => {",
  "  if (typeof value === 'string') return value;",
  "  try { return JSON.stringify(value); } catch { return String(value); }",
  "};",
  "const push = (level, args) => {",
  "  if (logLines.length >= maxLogs) return;",
  "  const text = level + ': ' + args.map(format).join(' ');",
  "  logLines.push(text.length > 2000 ? text.slice(0, 2000) : text);",
  "};",
  "globalThis.console = {",
  "  debug: (...args) => push('debug', args),",
  "  error: (...args) => push('error', args),",
  "  info: (...args) => push('info', args),",
  "  log: (...args) => push('log', args),",
  "  warn: (...args) => push('warn', args),",
  "};",
  "const pending = new Map();",
  "const outbox = [];",
  "let nextId = 0;",
  "let calls = 0;",
  "const callTool = (name, input) => new Promise((resolve, reject) => {",
  "  if (calls >= maxCalls) {",
  "    reject(new Error('The program exceeded its tool-call budget.'));",
  "    return;",
  "  }",
  "  calls += 1;",
  "  let encoded;",
  "  try { encoded = JSON.stringify(input === undefined ? {} : input); }",
  "  catch { encoded = '{}'; }",
  "  if (encoded.length > maxFrameChars) {",
  "    reject(new Error('The input to this tool call is larger than the sandbox allows.'));",
  "    return;",
  "  }",
  "  const id = nextId++;",
  "  pending.set(id, { reject, resolve });",
  "  outbox.push({ id, name, input: encoded });",
  "});",
  "globalThis.tools = new Proxy(Object.create(null), {",
  "  get: (_target, property) => {",
  "    if (typeof property !== 'string') return undefined;",
  "    return (input) => callTool(property, input);",
  "  },",
  "});",
  "let settlement;",
  "const messageOf = (error) => {",
  "  if (error !== null && error !== undefined && typeof error.message === 'string') return error.message;",
  "  return 'The program failed.';",
  "};",
  "// Settlement happens in the realm with intrinsics captured before the",
  "// program runs: the host must not adopt the program's promise through a",
  "// host-side then, because that would pass host functions into the realm and",
  "// read a property the program can replace.",
  "const settle = (promise) => {",
  "  reflectApply(promiseThen, promise, [",
  "    (value) => {",
  "      if (settlement !== undefined) return;",
  "      try { settlement = { ok: true, result: jsonStringify(value === undefined ? null : value) }; }",
  "      catch { settlement = { ok: false, message: 'The result is not representable as JSON.' }; }",
  "    },",
  "    (error) => {",
  "      if (settlement !== undefined) return;",
  "      settlement = { ok: false, message: messageOf(error) };",
  "    },",
  "  ]);",
  "};",
  "const settled = () => settlement === undefined ? null : jsonStringify(settlement);",
  "const bridge = {",
  "  deliver: (encoded) => {",
  "    const message = JSON.parse(encoded);",
  "    const entry = pending.get(message.id);",
  "    if (entry === undefined) return;",
  "    pending.delete(message.id);",
  "    if (message.ok === true) entry.resolve(message.value);",
  "    else entry.reject(new Error(String(message.error)));",
  "  },",
  "  drain: () => jsonStringify(outbox.splice(0, outbox.length)),",
  "  logs: () => jsonStringify(logLines),",
  "  settle,",
  "  settled,",
  "};",
  "// The host takes its references and deletes this global before the program",
  "// runs, so the program cannot reach the bridge at all.",
  "globalThis.__sandbox = bridge;",
  "})();",
].join("\n");

let context;
let drain;
let deliver;
let readLogs;
let settle;
let settled;
let poll;
let timer;
let finished = false;
let started = false;
let maxRssBytes = 268435456;

const send = (message) =>
  new Promise((resolve, reject) => {
    process.stdout.write(JSON.stringify(message) + "\n", (error) =>
      error ? reject(error) : resolve()
    );
  });

// The realm hands over JSON strings and nothing else; parsing them here is
// what keeps every object in the host on the host's side of the boundary.
const copyLogs = () => JSON.parse(readLogs());

const finish = (message) => {
  if (finished) return;
  finished = true;
  clearInterval(poll);
  clearInterval(timer);
  send(message).then(
    () => process.exit(0),
    () => process.exit(1)
  );
};

const drainCalls = () => {
  if (finished || drain === undefined) return;

  const calls = JSON.parse(drain());
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    send({
      type: "call",
      id: call.id,
      name: call.name,
      input: JSON.parse(call.input),
    }).catch(() => process.exit(1));
  }

  const raw = settled();
  if (raw === null) return;
  const outcome = JSON.parse(raw);
  if (outcome.ok === true) {
    finish({ type: "done", logs: copyLogs(), result: String(outcome.result) });
    return;
  }
  finish({ type: "error", logs: copyLogs(), message: String(outcome.message) });
};

const start = (message) => {
  const code = typeof message.code === "string" ? message.code : "";
  const evaluationMs =
    typeof message.evaluationMs === "number" ? message.evaluationMs : 1000;
  const maxCalls =
    typeof message.maxCalls === "number" ? message.maxCalls : 100;
  const maxLogs = typeof message.maxLogs === "number" ? message.maxLogs : 200;
  const maxFrameChars =
    typeof message.maxFrameChars === "number"
      ? message.maxFrameChars
      : 1048576;
  if (typeof message.maxRssBytes === "number") {
    maxRssBytes = message.maxRssBytes;
  }

  context = createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });
  context.__sandboxMaxLogs = maxLogs;
  context.__sandboxMaxCalls = maxCalls;
  context.__sandboxMaxFrameChars = maxFrameChars;
  runInContext(BOOTSTRAP, context);

  // Realm functions, held by the host. The program never sees these after the
  // bridge global is deleted, and none of them is a host function.
  drain = runInContext("__sandbox.drain", context);
  deliver = runInContext("__sandbox.deliver", context);
  readLogs = runInContext("__sandbox.logs", context);
  settle = runInContext("__sandbox.settle", context);
  settled = runInContext("__sandbox.settled", context);
  runInContext("delete globalThis.__sandbox", context);

  timer = setInterval(() => {
    if (process.memoryUsage().rss > maxRssBytes) {
      finish({
        type: "error",
        code: "MEMORY",
        logs: copyLogs(),
        message: "The program exceeded the sandbox's memory budget.",
      });
    }
  }, 100);

  const script = new Script("(async () => {\n" + code + "\n})()", {
    filename: "program.js",
  });
  let evaluation;
  try {
    evaluation = script.runInContext(context, { timeout: evaluationMs });
  } catch (error) {
    finish({
      type: "error",
      logs: copyLogs(),
      message:
        error && typeof error.message === "string"
          ? error.message
          : "The program did not finish evaluating.",
    });
    return;
  }

  // Settlement stays in the realm: settle is a realm function the host holds a
  // reference to, it adopts the program's promise with the realm's captured
  // then, and it records the outcome as JSON for the poll below.
  settle(evaluation);

  // Calls queued before the program's first await are picked up by the first
  // tick; the program itself cannot observe an interval it did not create.
  poll = setInterval(drainCalls, 5);
};

const connection = createInterface({ input: process.stdin });
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
  if (message.type !== "result" || deliver === undefined) return;
  deliver(JSON.stringify(message));
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
  /**
   * Set when the child stopped itself rather than failed: today only the
   * memory watchdog, which is a limit and not a crash.
   */
  code: Schema.optional(Schema.Literal("MEMORY")),
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
      readonly maxFrameChars: number;
      readonly maxLogs: number;
      readonly maxRssBytes: number;
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
            // A fixed argv, a fresh interpreter per request, and the
            // permission model on: the child cannot read a file, spawn a
            // process, spawn a worker, add a native addon, or open a socket.
            // An empty environment keeps the server's own variables — a
            // `NODE_OPTIONS` that preloads a module included — out of it.
            ChildProcess.make(
              process.execPath,
              [
                "--permission",
                // A program that allocates without bound dies on its own heap
                // rather than through the host's wall clock. The child's RSS
                // watchdog covers memory outside the V8 heap.
                "--max-old-space-size=128",
                "--input-type=module",
                "--no-warnings",
                "-e",
                RUNNER_SOURCE,
              ],
              { env: {} }
            )
          );
          yield* Effect.addFinalizer(() =>
            // A program that starves its own event loop cannot act on SIGTERM,
            // so the forced kill is the only termination the sandbox promises.
            child.kill({ forceKillAfter: "250 millis" }).pipe(Effect.ignore)
          );

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

          /**
           * One tool call, forked rather than awaited.
           *
           * The child sends at most one call at a time and waits for its
           * answer, so the stream never needs to block on the operation: a
           * forked call lets the pump keep reading, which is what lets a
           * child that dies — the memory watchdog, a crash — still deliver
           * its terminal message before the scope closes and interrupts the
           * in-flight call.
           */
          const handleCall = (message: typeof CallMessage.Type) =>
            Effect.gen(function* () {
              if ((yield* Ref.get(callCount)) >= limits.maxCalls) {
                return yield* limitExceeded(
                  "The program exceeded its tool-call budget."
                );
              }
              yield* Ref.update(callCount, (count) => count + 1);
              yield* Ref.update(calls, (names) => [...names, message.name]);

              yield* Effect.forkScoped(
                Effect.gen(function* () {
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
                })
              );
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
                return message.value.code === "MEMORY"
                  ? yield* limitExceeded(message.value.message)
                  : yield* crash(message.value.message);
            }
          });

          yield* write({
            code: program.code,
            evaluationMs: limits.evaluationMs,
            maxCalls: limits.maxCalls,
            maxFrameChars: MAX_FRAME_CHARS,
            maxLogs: limits.maxLogs,
            maxRssBytes: limits.maxRssBytes,
            type: "program",
          });

          // `Stream.splitLines` would buffer a line of any length before the
          // first handler sees it; this splitter carries the partial line
          // itself and refuses a frame that crosses the bound, so an oversized
          // message is never decoded and never accumulates.
          const pending = yield* Ref.make("");
          const pump = Stream.decodeText(child.stdout).pipe(
            Stream.runForEach((chunk) =>
              Effect.gen(function* () {
                const combined = (yield* Ref.get(pending)) + chunk;
                const lines = combined.split("\n");
                const rest = lines.pop() ?? "";
                yield* Ref.set(pending, rest);

                if (rest.length > MAX_FRAME_CHARS) {
                  return yield* limitExceeded(
                    `The sandbox wrote a frame larger than ${MAX_FRAME_CHARS} characters.`
                  );
                }
                for (const line of lines) {
                  if (line.length > MAX_FRAME_CHARS) {
                    return yield* limitExceeded(
                      `The sandbox wrote a frame larger than ${MAX_FRAME_CHARS} characters.`
                    );
                  }
                  if (line.length > 0) yield* handle(line);
                }
              })
            )
          );

          const outcome = yield* Effect.andThen(
            // The wall clock includes every tool call the program awaited, not
            // only its own compute: a program that spends its budget on calls
            // it did not need is the failure this bounds.
            Effect.timeoutOrElse(pump, {
              duration: Duration.millis(limits.wallClockMs),
              orElse: () =>
                child
                  .kill({ forceKillAfter: "250 millis" })
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
