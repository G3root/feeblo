/**
 * The browser's HTTP protocol: `effect`'s own batched HTTP protocol for the
 * frames that may share one request, and its unbatched one for the rest.
 *
 * The dashboard is client-only, and a route's `beforeLoad` starts its
 * collections with `Promise.all`: the post page asks for twelve of them at
 * once. Sent one request each, they are twelve browser requests through the
 * API's global middleware, and the browser's per-origin connection limit queues
 * the last six behind the first. Nothing on the server has to change for this:
 * `RpcServer`'s HTTP protocol decodes every frame in the request body, forks
 * one fiber per request, and streams the answers back interleaved by
 * `requestId`. Framing a body of several frames, posting it and routing each
 * streamed answer back to the caller waiting on its `requestId` is
 * `RpcClient.makeProtocolHttp`'s job once `batch` is set, so this module does
 * not implement any of it.
 *
 * What upstream cannot express is *which* frames may share a request, and that
 * decision is the reason this module exists rather than a plain
 * `layerProtocolHttp({ batch })`. `batch` applies to every frame a protocol
 * sends, so the caller decides instead: a frame is eligible only when
 * `sharesBatch` says so, which `index.ts` answers from the RPC's kind. Unary
 * reads wait out the window and travel together; everything else is posted on
 * its own from the caller's fiber.
 *
 * - Batching a write would put a mutation in one request with the page's reads,
 *   where it would pay the window and share a transport failure with them, and
 *   gain nothing — writes are not started in parallel the way a render's reads
 *   are.
 * - Batching a stream would hold the response open for as long as the stream.
 *   Every caller of a batch waits for the whole response to end, so the page's
 *   reads would not resolve until the stream did; and upstream runs the batch
 *   in the client's scope rather than in a caller's fiber, so closing the
 *   stream's scope would leave the HTTP request open. Sent alone, interruption
 *   aborts it.
 *
 * A frame that alone exceeds `maxSingleFrameBytes` is sent alone too: the
 * server refuses a body past its own limit, so one oversized frame must not
 * take the batch's other reads down with it. The batch itself is bounded by
 * upstream's `maxSize` frame count, not by a byte budget this module keeps.
 *
 * Call it only where the runtime belongs to one request: a batch carries one
 * set of request headers, so a runtime shared by concurrent requests (the
 * server's `ManagedRuntime`) must keep sending one request per call, or one
 * request's frames would be authenticated with another's session. `index.ts`
 * chooses with `hasWindow()` for exactly that reason.
 */
import { isString } from "@feeblo/utils/runtime-kind";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Layer from "effect/Layer";
import * as RpcClient from "effect/rpc/RpcClient";
import type { FromClientEncoded } from "effect/rpc/RpcMessage";
import * as RpcSerialization from "effect/rpc/RpcSerialization";

/** The frames one POST may carry; a burst past it is split across POSTs. */
const defaultMaxBatchFrames = 32;

/** A frame whose own body exceeds this travels alone, where it fails alone. */
const defaultMaxSingleFrameBytes = 64 * 1024;

/** How long a flush waits for the frames that start behind the first one. */
const defaultBatchWindow = Duration.millis(2);

interface ProtocolHttpBatchOptions {
  readonly url: string;
  /** Frames one POST may carry; a burst past it is split across POSTs. */
  readonly maxBatchFrames?: number | undefined;
  /** A frame whose own body exceeds this travels alone, where it fails alone. */
  readonly maxSingleFrameBytes?: number | undefined;
  /** How long a flush waits for the frames that start behind the first one. */
  readonly batchWindow?: Duration.Input | undefined;
  /**
   * Whether the frame's RPC may share a request with the frames beside it.
   * A frame this answers false for is posted on its own from the sender's
   * fiber, so interrupting the caller aborts its HTTP request. Defaults to
   * every frame; `index.ts` passes the RPC kind and the stream check, so
   * only unary reads share.
   */
  readonly sharesBatch?: ((tag: string) => boolean) | undefined;
}

const makeProtocolHttpBatch = (
  options: ProtocolHttpBatchOptions
): Effect.Effect<
  RpcClient.Protocol["Service"],
  never,
  RpcSerialization.RpcSerialization | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const serialization = yield* RpcSerialization.RpcSerialization;
    const maxSingleFrameBytes = Math.max(
      1,
      options.maxSingleFrameBytes ?? defaultMaxSingleFrameBytes
    );
    const sharesBatch = options.sharesBatch ?? (() => true);

    // `filterStatusOk` runs before either protocol reads a body: a non-2xx
    // answer (the session middleware's 401, the body limit's 413, a proxy's
    // 502) is not NDJSON, and without it every caller would see a decode
    // defect instead of the status the API reported.
    const client = HttpClient.mapRequest(
      http,
      HttpClientRequest.prependUrl(options.url)
    ).pipe(HttpClient.filterStatusOk);

    // Both protocols reach the same API with the same client; they differ only
    // in whether the frames they are handed leave together. Upstream keeps one
    // batch queue per client id inside each, which is what `run` below hands
    // both of them.
    const batched = yield* RpcClient.makeProtocolHttp(client, {
      batch: {
        window: options.batchWindow ?? defaultBatchWindow,
        maxSize: Math.max(1, options.maxBatchFrames ?? defaultMaxBatchFrames),
      },
    }).pipe(
      Effect.provideService(RpcSerialization.RpcSerialization, serialization)
    );
    const alone = yield* RpcClient.makeProtocolHttp(client).pipe(
      Effect.provideService(RpcSerialization.RpcSerialization, serialization)
    );

    const encodeText = new TextEncoder();

    /**
     * The frame's own body in bytes, the unit the ceiling is written in.
     * A serialization that frames in bytes reports no length rather than one
     * this ceiling would misread; upstream's batch limit is its only bound then.
     */
    const bodyBytes = (request: FromClientEncoded): Effect.Effect<number> =>
      Effect.suspend(() => {
        const encoded = serialization.makeUnsafe().encode(request);
        return Effect.succeed(
          isString(encoded) ? encodeText.encode(encoded).length : 0
        );
      });

    /**
     * The protocol one frame goes through. Only a frame `sharesBatch` accepts
     * is a candidate for the batched one, and only while its own body fits the
     * ceiling; everything else leaves through the unbatched protocol from the
     * sender's fiber. A non-request frame goes to the unbatched protocol too:
     * both drop it, and that is the one that does not encode first.
     */
    const protocolFor = (
      request: FromClientEncoded
    ): Effect.Effect<RpcClient.Protocol["Service"]> =>
      request._tag !== "Request" || !sharesBatch(request.tag)
        ? Effect.succeed(alone)
        : bodyBytes(request).pipe(
            Effect.map((bytes) =>
              bytes <= maxSingleFrameBytes ? batched : alone
            )
          );

    return {
      // Every frame is answered through the protocol that sent it, and each
      // keeps the writer for a client id until its own `run` ends, so both
      // have to hold one. Neither run ever completes, exactly as `run`
      // promises: the client's writer lives as long as the client does.
      run: (clientId, writeResponse) =>
        Effect.raceAll([
          batched.run(clientId, writeResponse),
          alone.run(clientId, writeResponse),
        ]),
      send: (clientId, request, transferables) =>
        Effect.flatMap(protocolFor(request), (protocol) =>
          protocol.send(clientId, request, transferables)
        ),
      supportsAck: batched.supportsAck,
      supportsTransferables: batched.supportsTransferables,
      codecFor: batched.codecFor,
    };
  });

export const layerProtocolHttpBatch = (
  options: ProtocolHttpBatchOptions
): Layer.Layer<
  RpcClient.Protocol,
  never,
  RpcSerialization.RpcSerialization | HttpClient.HttpClient
> => Layer.effect(RpcClient.Protocol, makeProtocolHttpBatch(options));
