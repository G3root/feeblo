/**
 * An RPC client protocol that sends the frames a surface starts together as one
 * HTTP request.
 *
 * The dashboard is client-only, and a route's `beforeLoad` starts its
 * collections with `Promise.all`: the post page asks for twelve of them at
 * once. Sent one request each, they are twelve browser requests through the
 * API's global middleware, and the browser's per-origin connection limit queues
 * the last six behind the first. Effect's server does not need to change for
 * this: `RpcServer`'s HTTP protocol decodes every frame in the request body,
 * forks one fiber per request, and streams the answers back interleaved by
 * `requestId`. Only the client sends one frame per POST.
 *
 * `send` therefore queues its encoded frame and returns; a flush loop posts the
 * frames that arrive inside a short window as one NDJSON body and routes each
 * answer back to the caller waiting on its `requestId`.
 *
 * Call it only where the runtime belongs to one request: a batch carries one
 * set of request headers, so a runtime shared by concurrent requests (the
 * server's `ManagedRuntime`) must keep sending one request per call, or one
 * request's frames would be authenticated with another's session. `index.ts`
 * chooses with `hasWindow()` for exactly that reason.
 */
import { isString } from "@feeblo/utils/runtime-kind";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import type { HttpClientError } from "effect/http/HttpClientError";
import { HttpClientErrorSchema } from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as RpcClient from "effect/rpc/RpcClient";
import { RpcClientDefect, RpcClientError } from "effect/rpc/RpcClientError";
import type {
  FromClientEncoded,
  FromServerEncoded,
  RequestEncoded,
} from "effect/rpc/RpcMessage";
import { isTerminalResponse } from "effect/rpc/RpcMessage";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

/** The frames one POST may carry; a burst past it is split across POSTs. */
const defaultMaxBatchFrames = 32;

/** How long a flush waits for the frames that start behind the first one. */
const defaultBatchWindow = Duration.millis(2);

const defect = (message: string, cause: unknown) =>
  new RpcClientError({ reason: new RpcClientDefect({ message, cause }) });

/** The one failure shape a caller sees, whichever layer of the pipe produced it. */
const toRpcClientError = (
  error: HttpClientError | RpcClientError
): RpcClientError =>
  Schema.is(RpcClientError)(error)
    ? error
    : new RpcClientError({
        reason: HttpClientErrorSchema.fromHttpClientError(error),
      });

/** The transport or protocol failure a batch's callers all see. */
const errorOfCause = (cause: Cause.Cause<RpcClientError>): RpcClientError => {
  const failure = Cause.findErrorOption(cause);
  return Option.isSome(failure)
    ? failure.value
    : defect("The batched RPC request failed", Cause.squash(cause));
};

/** One request the flush owes an answer. */
interface QueuedFrame {
  readonly clientId: number;
  readonly requestId: string | number;
  readonly frame: RequestEncoded;
  /** Completed once this request's terminal response has been written. */
  readonly done: Deferred.Deferred<void, RpcClientError>;
}

type FrameParser = ReturnType<
  RpcSerialization.RpcSerialization["Service"]["makeUnsafe"]
>;

/**
 * One frame as the text the batch body is built from. A serialization that
 * frames in bytes cannot drive this protocol, so it dies rather than joining a
 * body it would corrupt.
 */
const encodeFrame = (
  parser: FrameParser,
  frame: RequestEncoded
): Effect.Effect<string> =>
  Effect.suspend(() => {
    const encoded = parser.encode(frame);
    return isString(encoded)
      ? Effect.succeed(encoded)
      : Effect.die(
          new Error(
            "The batched RPC protocol needs a text serialization; only NDJSON is wired for it"
          )
        );
  });

/**
 * The request a response answers, or none for the connection-level frames
 * (`Defect`, `ClientProtocolError`) that carry no `requestId`.
 */
const requestIdOf = (frame: FromServerEncoded): string | number | undefined => {
  switch (frame._tag) {
    case "Chunk":
    case "Exit": {
      return frame.requestId;
    }
    default: {
      return undefined;
    }
  }
};

export const makeProtocolHttpBatch = (options: {
  readonly url: string;
  /** Frames one POST may carry; a burst past it is split across POSTs. */
  readonly maxBatchFrames?: number | undefined;
  /** How long a flush waits for the frames that start behind the first one. */
  readonly batchWindow?: Duration.Duration | undefined;
}): Effect.Effect<
  RpcClient.Protocol["Service"],
  never,
  RpcSerialization.RpcSerialization | HttpClient.HttpClient | Scope.Scope
> =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const serialization = yield* RpcSerialization.RpcSerialization;
    const client = HttpClient.mapRequest(
      http,
      HttpClientRequest.prependUrl(options.url)
    );
    const maxBatchFrames = Math.max(
      1,
      options.maxBatchFrames ?? defaultMaxBatchFrames
    );
    const batchWindow = options.batchWindow ?? defaultBatchWindow;

    return yield* RpcClient.Protocol.make(
      Effect.fnUntraced(function* (writeResponse) {
        const queue = yield* Queue.unbounded<QueuedFrame>();

        const fail = (pending: QueuedFrame, error: RpcClientError) =>
          Deferred.fail(pending.done, error).pipe(Effect.asVoid);

        /**
         * Post one window's frames as one body and route the streamed answers
         * back to the callers they belong to. Every failure inside is turned
         * into a failure for each request the batch still owes an answer to,
         * so one broken batch never strands a caller or the flush loop.
         */
        const sendBatch = (batch: ReadonlyArray<QueuedFrame>) =>
          Effect.gen(function* () {
            const waiting = new Map(
              batch.map((pending) => [pending.requestId, pending] as const)
            );
            const failWaiting = (error: RpcClientError) =>
              Effect.gen(function* () {
                for (const pending of waiting.values()) {
                  yield* fail(pending, error);
                }
                waiting.clear();
              });

            yield* Effect.gen(function* () {
              const parser = serialization.makeUnsafe();
              let body = "";
              for (const { frame } of batch) {
                body += yield* encodeFrame(parser, frame);
              }

              const response = yield* client.post("", {
                body: HttpBody.text(body, serialization.contentType),
              });

              yield* response.stream.pipe(
                Stream.runForEachArray((chunk) =>
                  Effect.gen(function* () {
                    // SAFETY: the serialization decodes only the protocol
                    // frames it encoded; every element is a server message.
                    const frames = chunk.flatMap(
                      parser.decode
                    ) as ReadonlyArray<FromServerEncoded>;
                    for (const frame of frames) {
                      const requestId = requestIdOf(frame);
                      if (requestId === undefined) continue;
                      const pending = waiting.get(requestId);
                      if (pending === undefined) continue;
                      yield* writeResponse(pending.clientId, frame);
                      // A chunk answers a stream, not the request; only the
                      // terminal frame releases its caller.
                      if (isTerminalResponse(frame)) {
                        waiting.delete(requestId);
                        yield* Deferred.succeed(pending.done, undefined);
                      }
                    }
                  })
                )
              );
            }).pipe(
              Effect.mapError(toRpcClientError),
              Effect.catchCause((cause) => failWaiting(errorOfCause(cause))),
              Effect.ensuring(
                failWaiting(
                  // A stream that ended without a terminal frame is the
                  // transport dropping the connection mid-batch; the callers
                  // see it as a failed request rather than waiting forever.
                  defect(
                    "The HTTP response ended before the RPC request completed",
                    undefined
                  )
                )
              )
            );
          }).pipe(Effect.forkScoped);

        yield* Effect.forkScoped(
          Effect.forever(
            Effect.gen(function* () {
              // One arrival opens the window; the rest of a render's reads land
              // inside it, because `Promise.all` starts them in one task.
              const first = yield* Queue.take(queue);
              yield* Effect.sleep(batchWindow);
              const batch = [first];
              // The window's remainder is drained with a non-blocking poll:
              // `takeBetween(0, n)` answers an empty array without looking at
              // the queue, and `takeAll` would wait for a second frame that a
              // lone call never sends, holding its answer forever.
              while (batch.length < maxBatchFrames) {
                const next = yield* Queue.poll(queue);
                if (Option.isNone(next)) break;
                batch.push(next.value);
              }
              yield* sendBatch(batch);
            })
          )
        );

        return {
          send: (clientId: number, request: FromClientEncoded) => {
            if (request._tag !== "Request") return Effect.void;

            return Effect.gen(function* () {
              const done = yield* Deferred.make<void, RpcClientError>();
              yield* Queue.offer(queue, {
                clientId,
                frame: request,
                requestId: request.id,
                done,
              });
              yield* Deferred.await(done);
            });
          },
          supportsAck: false,
          supportsTransferables: false,
          codecFor: serialization.codecFor,
        };
      })
    );
  });

export const layerProtocolHttpBatch = (options: {
  readonly url: string;
  /** Frames one POST may carry; a burst past it is split across POSTs. */
  readonly maxBatchFrames?: number | undefined;
  /** How long a flush waits for the frames that start behind the first one. */
  readonly batchWindow?: Duration.Duration | undefined;
}): Layer.Layer<
  RpcClient.Protocol,
  never,
  RpcSerialization.RpcSerialization | HttpClient.HttpClient
> => Layer.effect(RpcClient.Protocol)(makeProtocolHttpBatch(options));
