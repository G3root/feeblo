import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
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

import { layerProtocolHttpBatch } from "../src/batch-protocol";

const Add = Rpc.make("Add", {
  payload: Schema.Struct({ a: Schema.Finite, b: Schema.Finite }),
  success: Schema.Finite,
});
const Echo = Rpc.make("Echo", {
  payload: Schema.Struct({ text: Schema.String }),
  success: Schema.String,
});
const TestRpcs = RpcGroup.make(Add, Echo);

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
    readonly maxBatchBytes?: number;
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

  it.live("splits a batch at its byte budget", () =>
    Effect.gen(function* () {
      const posts = yield* Ref.make<ReadonlyArray<string>>([]);
      const context = yield* Layer.build(
        testLayer(answeringClient(posts), { maxBatchBytes: 1 })
      );

      const results = yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(TestRpcs);
        return yield* Effect.all(
          [client.Echo({ text: "one" }), client.Echo({ text: "two" })],
          { concurrency: "unbounded" }
        );
      }).pipe(Effect.provideContext(context));

      expect(results).toEqual(["one", "two"]);

      // Every frame is over a one-byte budget, so each is a group of one and
      // fails, if it fails, on its own.
      const bodies = yield* Ref.get(posts);
      expect(bodies.map((body) => framesIn(body).length)).toEqual([1, 1]);
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
