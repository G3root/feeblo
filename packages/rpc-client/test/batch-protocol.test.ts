import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as HttpClient from "effect/http/HttpClient";
import { HttpClientError, TransportError } from "effect/http/HttpClientError";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcClient from "effect/rpc/RpcClient";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import * as RpcGroup from "effect/rpc/RpcGroup";
import type {
  RequestEncoded,
  ResponseExitEncoded,
} from "effect/rpc/RpcMessage";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { layerProtocolHttpBatch } from "../src/batch-protocol";

const Add = Rpc.make("Add", {
  payload: Schema.Struct({ a: Schema.Finite, b: Schema.Finite }),
  success: Schema.Finite,
});
const Echo = Rpc.make("Echo", {
  payload: Schema.Struct({ text: Schema.String }),
  success: Schema.String,
});
const Watch = Rpc.make("Watch", {
  payload: Schema.Struct({}),
  stream: true,
  success: Schema.String,
});
const TestRpcs = RpcGroup.make(Add, Echo, Watch);

/**
 * The window the tests give a batch. Long enough that the calls `Effect.all`
 * forks in one task all land inside it on a loaded machine, short enough that
 * the tests stay fast.
 */
const testBatchWindow = Duration.millis(10);

/** The NDJSON frames a request body carried, in order. */
const framesIn = (body: string): ReadonlyArray<RequestEncoded> =>
  body
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      // SAFETY: the client writes NDJSON frames; JSON.parse reproduces them.
      return JSON.parse(line) as RequestEncoded;
    });

/** The body of a request the protocol posted. */
const bodyOf = (request: HttpClientRequest.HttpClientRequest): string => {
  const body = request.body;
  if (body._tag !== "Uint8Array") {
    throw new Error("The batched protocol must post a byte body");
  }
  return new TextDecoder().decode(body.body);
};

const exitOf = (
  requestId: string | number,
  value: number | string
): ResponseExitEncoded => ({
  _tag: "Exit",
  requestId,
  exit: { _tag: "Success", value },
});

/** One frame's answer, computed from its tag the way the real handler would. */
const answerOf = (
  frame: RequestEncoded
): Effect.Effect<ResponseExitEncoded> => {
  switch (frame.tag) {
    case "Add": {
      return Schema.decodeUnknownEffect(Add.payloadSchema)(frame.payload).pipe(
        Effect.orDie,
        Effect.map(({ a, b }) => exitOf(frame.id, a + b))
      );
    }
    case "Echo": {
      return Schema.decodeUnknownEffect(Echo.payloadSchema)(frame.payload).pipe(
        Effect.orDie,
        Effect.map(({ text }) => exitOf(frame.id, text))
      );
    }
    default: {
      return Effect.succeed({
        _tag: "Exit",
        requestId: frame.id,
        exit: {
          _tag: "Failure",
          cause: [{ _tag: "Die", defect: `Unknown RPC tag: ${frame.tag}` }],
        },
      });
    }
  }
};

/**
 * A stand-in for the API: it records every body it is sent and answers each
 * frame it carries, in reverse order, so a passing test proves the callers were
 * matched by `requestId` rather than by position.
 */
const answeringClient = (
  posts: Ref.Ref<ReadonlyArray<string>>
): Layer.Layer<
  HttpClient.HttpClient,
  never,
  RpcSerialization.RpcSerialization
> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const serialization = yield* RpcSerialization.RpcSerialization;
      return HttpClient.make((request) =>
        Effect.gen(function* () {
          const body = bodyOf(request);
          yield* Ref.update(posts, (all) => [...all, body]);
          const answers = yield* Effect.forEach(
            framesIn(body).toReversed(),
            (frame) =>
              answerOf(frame).pipe(
                Effect.map((answer) => JSON.stringify(answer) + "\n")
              )
          );
          return HttpClientResponse.fromWeb(
            request,
            new Response(answers.join(""), {
              status: 200,
              headers: { "content-type": serialization.contentType },
            })
          );
        })
      );
    })
  );

/**
 * A transport that answers each unary frame and then ends the response, the way
 * the API ends a batch once every request in it is answered. A body carrying a
 * `Watch` frame instead stays open, the way a stream's response does, after
 * delivering the chunk the stream produced.
 */
const streamingClient = (
  posts: Ref.Ref<ReadonlyArray<string>>,
  cancels: { count: number }
): Layer.Layer<
  HttpClient.HttpClient,
  never,
  RpcSerialization.RpcSerialization
> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const serialization = yield* RpcSerialization.RpcSerialization;
      return HttpClient.make((request) =>
        Effect.gen(function* () {
          const body = bodyOf(request);
          yield* Ref.update(posts, (all) => [...all, body]);
          const frames = framesIn(body);
          const answers = yield* Effect.forEach(frames, (frame) =>
            frame.tag === "Watch"
              ? Effect.succeed(
                  JSON.stringify({
                    _tag: "Chunk",
                    requestId: frame.id,
                    values: ["tick"],
                  }) + "\n"
                )
              : answerOf(frame).pipe(
                  Effect.map((answer) => JSON.stringify(answer) + "\n")
                )
          );
          const encoded = answers.join("");
          const headers = { "content-type": serialization.contentType };
          return HttpClientResponse.fromWeb(
            request,
            frames.some((frame) => frame.tag === "Watch")
              ? new Response(
                  new ReadableStream({
                    start(controller) {
                      controller.enqueue(new TextEncoder().encode(encoded));
                    },
                    cancel() {
                      cancels.count += 1;
                    },
                  }),
                  { status: 200, headers }
                )
              : new Response(encoded, { status: 200, headers })
          );
        })
      );
    })
  );

/**
 * Answers every body with the connection-level `Defect` the server writes when
 * it cannot read a request body, after a delay long enough that a second
 * client's request has been sent and is still in flight.
 */
const delayedDefectClient = (): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sleep(Duration.millis(50)).pipe(
        Effect.as(
          HttpClientResponse.fromWeb(
            request,
            new Response(
              JSON.stringify({
                _tag: "Defect",
                defect: { message: "server exploded" },
              }) + "\n",
              { status: 200, headers: { "content-type": "application/ndjson" } }
            )
          )
        )
      )
    )
  );

/**
 * Answers a body that carries a `Watch` with one chunk and leaves the response
 * open, the way a real watch does. Any other body gets the connection-level
 * `Defect` the server writes when it cannot read a request body.
 */
const defectBesideStreamClient = (
  posts: Ref.Ref<ReadonlyArray<string>>
): Layer.Layer<
  HttpClient.HttpClient,
  never,
  RpcSerialization.RpcSerialization
> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const serialization = yield* RpcSerialization.RpcSerialization;
      return HttpClient.make((request) =>
        Effect.gen(function* () {
          const body = bodyOf(request);
          yield* Ref.update(posts, (all) => [...all, body]);
          const frames = framesIn(body);
          const headers = { "content-type": serialization.contentType };
          const watching = frames.find((frame) => frame.tag === "Watch");
          if (watching === undefined) {
            return HttpClientResponse.fromWeb(
              request,
              new Response(
                JSON.stringify({
                  _tag: "Defect",
                  defect: { message: "server exploded" },
                }) + "\n",
                { status: 200, headers }
              )
            );
          }
          return HttpClientResponse.fromWeb(
            request,
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      JSON.stringify({
                        _tag: "Chunk",
                        requestId: watching.id,
                        values: ["tick"],
                      }) + "\n"
                    )
                  );
                },
              }),
              { status: 200, headers }
            )
          );
        })
      );
    })
  );

/** A transport that never reaches the API. */
const failingClient = (): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.fail(
        new HttpClientError({
          reason: new TransportError({ request, description: "network down" }),
        })
      )
    )
  );

/** A transport that answers 200 with no frames at all. */
const silentClient = (): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response("", {
            status: 200,
            headers: { "content-type": "application/ndjson" },
          })
        )
      )
    )
  );

/**
 * A transport whose response body never yields and never closes, the shape a
 * watch RPC keeps. `cancels.count` proves whether the client aborted it.
 */
const openEndedClient = (cancels: {
  count: number;
}): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() =>
        HttpClientResponse.fromWeb(
          request,
          new Response(
            new ReadableStream({
              start() {
                // Never enqueue and never close.
              },
              cancel() {
                cancels.count += 1;
              },
            }),
            { status: 200, headers: { "content-type": "application/ndjson" } }
          )
        )
      )
    )
  );

/**
 * A transport that answers with the connection-level `Defect` the server writes
 * when it cannot read a body, then ends the response.
 */
const defectClient = (): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(
            JSON.stringify({
              _tag: "Defect",
              defect: { message: "server exploded" },
            }) + "\n",
            {
              status: 200,
              headers: { "content-type": "application/ndjson" },
            }
          )
        )
      )
    )
  );

/**
 * A transport that answers a non-2xx body the frame decoder cannot read, the
 * way an auth middleware, a body limit or a proxy does.
 */
const unavailableClient = (): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response("Service Unavailable", {
            status: 503,
            headers: { "content-type": "text/plain" },
          })
        )
      )
    )
  );

const testLayer = (
  client: Layer.Layer<
    HttpClient.HttpClient,
    never,
    RpcSerialization.RpcSerialization
  >,
  options?: {
    readonly batchWindow?: Duration.Duration;
    readonly maxSingleFrameBytes?: number;
    readonly sharesBatch?: (tag: string) => boolean;
  }
): Layer.Layer<RpcClient.Protocol> =>
  layerProtocolHttpBatch({
    url: "http://rpc.test/rpc",
    batchWindow: testBatchWindow,
    ...options,
  }).pipe(Layer.provide(client), Layer.provide(RpcSerialization.layerNdjson));

describe("batched RPC protocol", () => {
  it.live("posts calls that start together as one request", () =>
    Effect.gen(function* () {
      const posts = yield* Ref.make<ReadonlyArray<string>>([]);
      const context = yield* Layer.build(testLayer(answeringClient(posts)));

      const results = yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(TestRpcs);
        return yield* Effect.all(
          [
            client.Add({ a: 1, b: 2 }),
            client.Echo({ text: "hello" }),
            client.Add({ a: 20, b: 22 }),
          ],
          { concurrency: "unbounded" }
        );
      }).pipe(Effect.provideContext(context));

      expect(results).toEqual([3, "hello", 42]);

      const bodies = yield* Ref.get(posts);
      expect(bodies).toHaveLength(1);
      expect(framesIn(bodies[0] ?? "").map((frame) => frame.tag)).toEqual([
        "Add",
        "Echo",
        "Add",
      ]);
    })
  );

  it.live("posts a call that starts alone as one request", () =>
    Effect.gen(function* () {
      const posts = yield* Ref.make<ReadonlyArray<string>>([]);
      const context = yield* Layer.build(testLayer(answeringClient(posts)));

      const total = yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(TestRpcs);
        return yield* client.Add({ a: 40, b: 2 });
      }).pipe(Effect.provideContext(context));

      expect(total).toBe(42);

      const bodies = yield* Ref.get(posts);
      expect(bodies).toHaveLength(1);
      expect(framesIn(bodies[0] ?? "")).toHaveLength(1);
    })
  );

  it.live("sends a frame the classifier rules out alone and at once", () =>
    Effect.gen(function* () {
      const posts = yield* Ref.make<ReadonlyArray<string>>([]);
      const context = yield* Layer.build(
        testLayer(answeringClient(posts), {
          sharesBatch: (tag) => tag === "Echo",
        })
      );

      const results = yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(TestRpcs);
        return yield* Effect.all(
          [client.Add({ a: 1, b: 2 }), client.Echo({ text: "hello" })],
          { concurrency: "unbounded" }
        );
      }).pipe(Effect.provideContext(context));

      expect(results).toEqual([3, "hello"]);

      // The write leaves on its own resolver, without the read's window, so the
      // page's reads never wait on it and a write failure never carries them.
      const bodies = yield* Ref.get(posts);
      expect(bodies.map((body) => framesIn(body).map((f) => f.tag))).toEqual([
        ["Add"],
        ["Echo"],
      ]);
    })
  );

  it.live("posts each write of a burst as its own request", () =>
    Effect.gen(function* () {
      const posts = yield* Ref.make<ReadonlyArray<string>>([]);
      const context = yield* Layer.build(
        testLayer(answeringClient(posts), { sharesBatch: () => false })
      );

      const results = yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(TestRpcs);
        return yield* Effect.all(
          [client.Add({ a: 1, b: 2 }), client.Add({ a: 20, b: 22 })],
          { concurrency: "unbounded" }
        );
      }).pipe(Effect.provideContext(context));

      expect(results).toEqual([3, 42]);

      const bodies = yield* Ref.get(posts);
      expect(bodies.map((body) => framesIn(body).length)).toEqual([1, 1]);
    })
  );

  it.live(
    "posts a frame that cannot share without waiting out the window",
    () =>
      Effect.gen(function* () {
        const posts = yield* Ref.make<ReadonlyArray<string>>([]);
        const context = yield* Layer.build(
          testLayer(answeringClient(posts), {
            batchWindow: Duration.seconds(30),
            sharesBatch: () => false,
          })
        );

        // A frame that went through the reads resolver would sit out the 30s
        // window; a direct send answers inside the timeout.
        const total = yield* Effect.gen(function* () {
          const client = yield* RpcClient.make(TestRpcs);
          return yield* client.Add({ a: 40, b: 2 });
        }).pipe(
          Effect.timeout(Duration.seconds(1)),
          Effect.provideContext(context)
        );

        expect(total).toBe(42);

        const bodies = yield* Ref.get(posts);
        expect(bodies).toHaveLength(1);
      })
  );

  it.live("cancels a response whose caller is interrupted", () =>
    Effect.gen(function* () {
      const cancels = { count: 0 };
      const context = yield* Layer.build(
        testLayer(openEndedClient(cancels), { sharesBatch: () => false })
      );

      yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(TestRpcs);
        // A stream that never yields: only the caller's interruption ends it.
        yield* Stream.runDrain(client.Watch({})).pipe(
          Effect.timeout(Duration.millis(50)),
          Effect.ignore
        );
      }).pipe(Effect.provideContext(context));

      // The frame is posted from the stream's own fiber, so closing the scope
      // must abort the HTTP request rather than leave it pumping forever.
      yield* Effect.sleep(Duration.millis(200));
      expect(cancels.count).toBe(1);
    })
  );

  it.live("sends a frame larger than the ceiling alone", () =>
    Effect.gen(function* () {
      const posts = yield* Ref.make<ReadonlyArray<string>>([]);
      const context = yield* Layer.build(
        testLayer(answeringClient(posts), { maxSingleFrameBytes: 1 })
      );

      const results = yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(TestRpcs);
        return yield* Effect.all(
          [client.Echo({ text: "one" }), client.Echo({ text: "two" })],
          { concurrency: "unbounded" }
        );
      }).pipe(Effect.provideContext(context));

      expect(results).toEqual(["one", "two"]);

      // Both frames are over a one-byte ceiling, so neither can take the
      // other down with it when the API refuses the body.
      const bodies = yield* Ref.get(posts);
      expect(bodies.map((body) => framesIn(body).length)).toEqual([1, 1]);
    })
  );

  it.live("answers a batched read while a stream stays open", () =>
    Effect.gen(function* () {
      const posts = yield* Ref.make<ReadonlyArray<string>>([]);
      const cancels = { count: 0 };
      const context = yield* Layer.build(
        testLayer(streamingClient(posts, cancels), {
          sharesBatch: (tag) => tag !== "Watch",
        })
      );

      const total = yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(TestRpcs);
        // A watch the dashboard keeps open, started in the same render as the
        // read. It must not share the read's request: interrupting a batched
        // stream does not cancel its HTTP request, so this one would keep
        // pumping long after its atom was disposed.
        const watching = yield* Stream.runDrain(client.Watch({})).pipe(
          Effect.forkChild
        );
        const sum = yield* client.Add({ a: 40, b: 2 });
        yield* Fiber.interrupt(watching);
        return sum;
      }).pipe(
        Effect.timeout(Duration.seconds(5)),
        Effect.provideContext(context)
      );

      expect(total).toBe(42);

      // Two requests, one frame each: the watch left from its own fiber and the
      // read waited out the window alone rather than with it.
      const bodies = yield* Ref.get(posts);
      const posted = bodies.map((body) => framesIn(body).map((f) => f.tag));
      expect(posted.map((tags) => tags.length)).toEqual([1, 1]);
      expect(posted.flat().sort()).toEqual(["Add", "Watch"]);

      // The watch's response is held open until its caller is interrupted, and
      // interrupting it has to abort the request rather than leave it pumping.
      yield* Effect.sleep(Duration.millis(100));
      expect(cancels.count).toBe(1);
    })
  );

  it.live("fails only the exchanges the defect-carrying POST carried", () =>
    Effect.gen(function* () {
      const posts = yield* Ref.make<ReadonlyArray<string>>([]);
      const context = yield* Layer.build(
        testLayer(defectBesideStreamClient(posts), {
          sharesBatch: (tag) => tag !== "Watch",
        })
      );

      const { outcome, watching } = yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(TestRpcs);
        // An open watch on one protocol and a read on the other: a defect in the
        // read's body used to die every pending request of the client.
        const fiber = yield* Stream.runDrain(client.Watch({})).pipe(
          Effect.forkChild
        );
        yield* Effect.sleep(Duration.millis(50));
        const read = yield* client.Add({ a: 1, b: 2 }).pipe(Effect.exit);
        // A fiber that is still running has not finished within the window; a
        // defect that reached the watch would have ended it with a failure.
        const finished = yield* Fiber.await(fiber).pipe(
          Effect.timeoutOption(Duration.millis(200))
        );
        yield* Fiber.interrupt(fiber);
        return { outcome: read, watching: finished };
      }).pipe(
        Effect.timeout(Duration.seconds(5)),
        Effect.provideContext(context)
      );

      // The read sees the cause the server sent...
      expect(Exit.isFailure(outcome)).toBe(true);
      const failure = Exit.isFailure(outcome)
        ? Cause.findErrorOption(outcome.cause)
        : Option.none();
      expect(Option.isSome(failure)).toBe(true);
      const error = Option.getOrThrow(failure);
      expect(error.reason._tag).toBe("RpcClientDefect");
      if (error.reason._tag === "RpcClientDefect") {
        expect(String(error.reason.cause)).toContain("server exploded");
      }

      // ...and the watch never saw it.
      expect(Option.isNone(watching)).toBe(true);

      const bodies = yield* Ref.get(posts);
      expect(bodies.map((body) => framesIn(body).map((f) => f.tag))).toEqual([
        ["Watch"],
        ["Add"],
      ]);
    })
  );

  it.live("keeps each client's pending requests apart", () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(testLayer(delayedDefectClient()));

      // Two clients over one protocol layer, the way the dashboard's promise
      // runtime and its `AtomRpc` runtimes share `rpcProtocolFor`'s layer. Each
      // gets its own client id, so a defect that names one client's requests
      // must not consume the other's tracking.
      const outcomes = yield* Effect.gen(function* () {
        const a = yield* RpcClient.make(TestRpcs);
        const b = yield* RpcClient.make(TestRpcs);
        // Both in flight before either defect lands: that is the window in
        // which a shared tracker lets one client's defect clear the other's.
        return yield* Effect.all(
          [
            a.Add({ a: 1, b: 2 }).pipe(Effect.exit),
            b.Add({ a: 1, b: 2 }).pipe(Effect.exit),
          ],
          { concurrency: "unbounded" }
        );
      }).pipe(
        Effect.timeout(Duration.seconds(5)),
        Effect.provideContext(context)
      );

      // Both see the cause the server sent. Without per-client tracking the
      // first defect consumes the second client's id, and its call fails with
      // the synthesized "HTTP response ended before RPC request completed".
      for (const outcome of outcomes) {
        expect(Exit.isFailure(outcome)).toBe(true);
        const failure = Exit.isFailure(outcome)
          ? Cause.findErrorOption(outcome.cause)
          : Option.none();
        expect(Option.isSome(failure)).toBe(true);
        const error = Option.getOrThrow(failure);
        expect(error.reason._tag).toBe("RpcClientDefect");
        if (error.reason._tag === "RpcClientDefect") {
          expect(String(error.reason.cause)).toContain("server exploded");
        }
      }
    })
  );

  /**
   * The canary for this module's reason to exist.
   *
   * It asserts what upstream does *not* do: a stream that shares a batch keeps
   * its HTTP request pumping after its caller is interrupted, because the batch
   * runs in the client's scope and only `Request` frames are forwarded. If this
   * test starts failing, a release of `effect` learned to cancel a batched
   * stream — at which point `sharesBatch`, `rpc-kind.ts` and this dispatcher can
   * all be deleted and `layerProtocolHttp({ batch })` used directly.
   */
  it.live(
    "leaks a batched stream's request when its caller is interrupted",
    () =>
      Effect.gen(function* () {
        const posts = yield* Ref.make<ReadonlyArray<string>>([]);
        const cancels = { count: 0 };
        const context = yield* Layer.build(
          testLayer(streamingClient(posts, cancels), {
            sharesBatch: () => true,
          })
        );

        yield* Effect.gen(function* () {
          const client = yield* RpcClient.make(TestRpcs);
          const watching = yield* Stream.runDrain(client.Watch({})).pipe(
            Effect.forkChild
          );
          yield* Effect.sleep(Duration.millis(50));
          yield* Fiber.interrupt(watching);
          yield* Effect.sleep(Duration.millis(200));
        }).pipe(Effect.provideContext(context));

        // Batched: one request, still open after the caller went away.
        expect(yield* Ref.get(posts)).toHaveLength(1);
        expect(cancels.count).toBe(0);
      })
  );

  it.live("fails every caller in a batch when the transport drops", () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(testLayer(failingClient()));

      const outcomes = yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(TestRpcs);
        return yield* Effect.all(
          [
            client.Add({ a: 1, b: 2 }).pipe(Effect.exit),
            client.Echo({ text: "hello" }).pipe(Effect.exit),
          ],
          { concurrency: "unbounded" }
        );
      }).pipe(Effect.provideContext(context));

      expect(Exit.isFailure(outcomes[0])).toBe(true);
      expect(Exit.isFailure(outcomes[1])).toBe(true);
    })
  );

  it.live("fails a caller whose batch ends without a terminal frame", () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(testLayer(silentClient()));

      const outcome = yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(TestRpcs);
        return yield* client.Add({ a: 1, b: 2 }).pipe(Effect.exit);
      }).pipe(Effect.provideContext(context));

      expect(Exit.isFailure(outcome)).toBe(true);
    })
  );

  it.live("fails every caller with the defect the server reported", () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(testLayer(defectClient()));

      const outcomes: ReadonlyArray<
        Exit.Exit<number | string, RpcClientError>
      > = yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(TestRpcs);
        return yield* Effect.all(
          [
            client.Add({ a: 1, b: 2 }).pipe(Effect.exit),
            client.Echo({ text: "hello" }).pipe(Effect.exit),
          ],
          { concurrency: "unbounded" }
        );
      }).pipe(Effect.provideContext(context));

      // The server could not read this body, so every request it carried fails
      // with the cause the server sent.
      const failures = outcomes.map((outcome) =>
        Exit.isFailure(outcome)
          ? Cause.findErrorOption(outcome.cause)
          : Option.none()
      );

      for (const failure of failures) {
        expect(Option.isSome(failure)).toBe(true);
        const error = Option.getOrThrow(failure);
        expect(error.reason._tag).toBe("RpcClientDefect");
        if (error.reason._tag === "RpcClientDefect") {
          expect(String(error.reason.cause)).toContain("server exploded");
        }
      }
    })
  );

  it.live(
    "fails every caller with the HTTP status when the API answers a non-2xx",
    () =>
      Effect.gen(function* () {
        const context = yield* Layer.build(testLayer(unavailableClient()));

        const outcomes: ReadonlyArray<
          Exit.Exit<number | string, RpcClientError>
        > = yield* Effect.gen(function* () {
          const client = yield* RpcClient.make(TestRpcs);
          return yield* Effect.all(
            [
              client.Add({ a: 1, b: 2 }).pipe(Effect.exit),
              client.Echo({ text: "hello" }).pipe(Effect.exit),
            ],
            { concurrency: "unbounded" }
          );
        }).pipe(Effect.provideContext(context));

        const failures = outcomes.map((outcome) =>
          Exit.isFailure(outcome)
            ? Cause.findErrorOption(outcome.cause)
            : Option.none()
        );
        // The status survives: without the client's status filter the plain-text
        // body would reach the frame decoder, and the callers would see a decode
        // defect with no idea the API said 503.
        for (const failure of failures) {
          expect(Option.isSome(failure)).toBe(true);
          const error = Option.getOrThrow(failure);
          expect(error.reason._tag).toBe("HttpError");
          if (error.reason._tag === "HttpError") {
            expect(error.reason.kind).toBe("StatusCodeError");
          }
        }
      })
  );
});
