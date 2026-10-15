/**
 * An RPC client protocol that sends the reads a surface starts together as one
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
 * A frame is eligible to share a batch only when `sharesBatch` says so, which
 * `index.ts` answers from the RPC's kind: reads wait out a short window
 * together, a write travels on its own and leaves at once. Batching a write
 * would put a mutation in one request with the page's reads, where it would pay
 * the window, share a byte budget and a transport failure with them, and gain
 * nothing — writes are not started in parallel the way a render's reads are.
 *
 * A batch is posted as an NDJSON body of the frames that arrived inside the
 * window (at most `maxBatchFrames`, at most `maxBatchBytes`), and each answer
 * is routed back to the caller waiting on its `requestId`. Every failure path
 * fails each request the batch still owes an answer to, so one dropped
 * connection never strands a caller.
 *
 * Call it only where the runtime belongs to one request: a batch carries one
 * set of request headers, so a runtime shared by concurrent requests (the
 * server's `ManagedRuntime`) must keep sending one request per call, or one
 * request's frames would be authenticated with another's session. `index.ts`
 * chooses with `hasWindow()` for exactly that reason.
 */
import { isString } from "@feeblo/utils/runtime-kind";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import type { HttpClientError } from "effect/http/HttpClientError";
import { HttpClientErrorSchema } from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Request from "effect/Request";
import * as RequestResolver from "effect/RequestResolver";
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
import * as Stream from "effect/Stream";

/** The frames one POST may carry; a burst past it is split across POSTs. */
const defaultMaxBatchFrames = 32;

/** The encoded bytes one POST may carry; a frame that alone exceeds it travels alone. */
const defaultMaxBatchBytes = 64 * 1024;

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

/** One frame a batch owes an answer to. */
class BatchedFrame extends Request.Class<
  {
    readonly clientId: number;
    readonly requestId: string | number;
    /** The frame as the batch body carries it, encoded once at the call site. */
    readonly encoded: string;
    /** The encoded frame's UTF-8 length, the byte budget's unit. */
    readonly byteLength: number;
  },
  void,
  RpcClientError
> {}

export const makeProtocolHttpBatch = (options: {
  readonly url: string;
  /** Frames one POST may carry; a burst past it is split across POSTs. */
  readonly maxBatchFrames?: number | undefined;
  /** Encoded bytes one POST may carry; a frame that alone exceeds it travels alone. */
  readonly maxBatchBytes?: number | undefined;
  /** How long a flush waits for the frames that start behind the first one. */
  readonly batchWindow?: Duration.Duration | undefined;
  /**
   * Whether the frame's RPC may share a request with the frames beside it.
   * A frame this answers false for is sent on its own, immediately. Defaults
   * to every frame; `index.ts` passes the RPC kind, so only reads share.
   */
  readonly sharesBatch?: ((tag: string) => boolean) | undefined;
}): Effect.Effect<
  RpcClient.Protocol["Service"],
  never,
  RpcSerialization.RpcSerialization | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const serialization = yield* RpcSerialization.RpcSerialization;
    const client = HttpClient.mapRequest(
      http,
      HttpClientRequest.prependUrl(options.url)
    ).pipe(HttpClient.filterStatusOk);
    const maxBatchFrames = Math.max(
      1,
      options.maxBatchFrames ?? defaultMaxBatchFrames
    );
    const maxBatchBytes = Math.max(
      1,
      options.maxBatchBytes ?? defaultMaxBatchBytes
    );
    const batchWindow = options.batchWindow ?? defaultBatchWindow;
    const sharesBatch = options.sharesBatch ?? (() => true);
    const encodeText = new TextEncoder();
    const decodeDefect = Schema.decodeUnknownEffect(
      serialization.codecFor(Schema.Defect())
    );

    /**
     * The server's connection-level defect, decoded with the protocol's own
     * codec so a caller sees the cause the server reported rather than the
     * frame that carried it. A frame the codec cannot read stays as it came.
     */
    const serverDefect = (cause: unknown): Effect.Effect<RpcClientError> =>
      decodeDefect(cause).pipe(
        Effect.match({
          onFailure: () => defect("The RPC server reported a defect", cause),
          onSuccess: (decoded) =>
            defect("The RPC server reported a defect", decoded),
        })
      );

    return yield* RpcClient.Protocol.make((writeResponse) => {
      /**
       * Post one group's frames as one body and route the streamed answers
       * back to the callers they belong to. Every failure inside is turned
       * into a failure for each request the group still owes an answer to,
       * so one broken batch never strands a caller.
       */
      const sendGroup = (entries: ReadonlyArray<Request.Entry<BatchedFrame>>) =>
        Effect.gen(function* () {
          const waiting = new Map(
            entries.map((entry) => [entry.request.requestId, entry] as const)
          );
          const failWaiting = (error: RpcClientError) =>
            Effect.sync(() => {
              for (const entry of waiting.values()) {
                entry.completeUnsafe(Exit.fail(error));
              }
              waiting.clear();
            });

          yield* Effect.gen(function* () {
            const parser = serialization.makeUnsafe();
            let body = "";
            for (const { request } of entries) {
              body += request.encoded;
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
                    switch (frame._tag) {
                      case "Chunk":
                      case "Exit": {
                        const entry = waiting.get(frame.requestId);
                        if (entry === undefined) break;
                        yield* writeResponse(entry.request.clientId, frame);
                        // A chunk answers a stream, not the request; only
                        // the terminal frame releases its caller.
                        if (isTerminalResponse(frame)) {
                          waiting.delete(frame.requestId);
                          entry.completeUnsafe(Exit.succeed(undefined));
                        }
                        break;
                      }
                      case "Defect": {
                        // Connection-level: the server could not read the
                        // body, so no request in it has an answer coming.
                        yield* failWaiting(yield* serverDefect(frame.defect));
                        break;
                      }
                      case "ClientProtocolError": {
                        yield* failWaiting(frame.error);
                        break;
                      }
                      default: {
                        break;
                      }
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
        });

      /**
       * One resolver run's frames, split by the byte budget the way
       * `batchN` already split them by count: the server refuses a body past
       * its own limit, so an oversized frame must not take the batch's other
       * reads down with it. A frame larger than the whole budget is a group
       * of one, and fails alone.
       */
      const sendResolved = (
        entries: ReadonlyArray<Request.Entry<BatchedFrame>>
      ) =>
        Effect.gen(function* () {
          const groups: Array<Array<Request.Entry<BatchedFrame>>> = [];
          let group: Array<Request.Entry<BatchedFrame>> = [];
          let bytes = 0;

          for (const entry of entries) {
            if (
              group.length > 0 &&
              bytes + entry.request.byteLength > maxBatchBytes
            ) {
              groups.push(group);
              group = [];
              bytes = 0;
            }
            group.push(entry);
            bytes += entry.request.byteLength;
          }

          if (group.length > 0) {
            groups.push(group);
          }

          yield* Effect.forEach(groups, sendGroup, {
            concurrency: "unbounded",
            discard: true,
          });
        });

      // One resolver per kind, both posting through the same pipe: reads
      // wait out the window and travel together; writes are each their own
      // batch and leave at once.
      const reads = RequestResolver.make<BatchedFrame>(sendResolved).pipe(
        RequestResolver.setDelay(batchWindow),
        RequestResolver.batchN(maxBatchFrames)
      );
      const writes = RequestResolver.make<BatchedFrame>(sendResolved).pipe(
        RequestResolver.batchN(1)
      );

      return Effect.succeed({
        send: (clientId: number, request: FromClientEncoded) => {
          if (request._tag !== "Request") return Effect.void;

          return Effect.gen(function* () {
            const parser = serialization.makeUnsafe();
            const encoded = yield* encodeFrame(parser, request);
            const frame = new BatchedFrame({
              clientId,
              requestId: request.id,
              encoded,
              byteLength: encodeText.encode(encoded).length,
            });
            yield* Effect.request(
              frame,
              sharesBatch(request.tag) ? reads : writes
            );
          });
        },
        supportsAck: false,
        supportsTransferables: false,
        codecFor: serialization.codecFor,
      });
    });
  });

export const layerProtocolHttpBatch = (options: {
  readonly url: string;
  /** Frames one POST may carry; a burst past it is split across POSTs. */
  readonly maxBatchFrames?: number | undefined;
  /** Encoded bytes one POST may carry; a frame that alone exceeds it travels alone. */
  readonly maxBatchBytes?: number | undefined;
  /** How long a flush waits for the frames that start behind the first one. */
  readonly batchWindow?: Duration.Duration | undefined;
  /** Whether the frame's RPC may share a request with the frames beside it. */
  readonly sharesBatch?: ((tag: string) => boolean) | undefined;
}): Layer.Layer<
  RpcClient.Protocol,
  never,
  RpcSerialization.RpcSerialization | HttpClient.HttpClient
> => Layer.effect(RpcClient.Protocol)(makeProtocolHttpBatch(options));
