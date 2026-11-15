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
 * - Batching a stream leaks the connection. Upstream runs a batch in the
 *   client's scope rather than in a caller's fiber, and it only forwards
 *   `Request` frames, so interrupting a stream's caller neither ends the batch
 *   nor cancels its HTTP request: the response keeps pumping until the client
 *   itself shuts down. The data-transfer page is where that shows — its watch
 *   atoms are keyed by filter, so every filter change abandons a stream — and
 *   the browser's per-origin connection limit turns a handful of abandoned
 *   watches into a stalled tab. Sent alone, interruption aborts the request.
 *
 *   Interrupting a *batched* stream does not stall the page's reads: answers are
 *   written as their frames arrive, not when the response ends. The leak is the
 *   whole difference, and `batch-protocol.test.ts` pins both halves so that a
 *   future Effect release that cancels batched streams says so by failing it, at
 *   which point this module can go.
 *
 * A frame that alone exceeds `maxSingleFrameBytes` is sent alone too: the
 * server refuses a body past its own limit, so one oversized frame must not
 * take the batch's other reads down with it. The batch itself is bounded by
 * upstream's `maxSize` frame count, not by a byte budget this module keeps.
 *
 * A `Defect` frame is the one response this module rewrites. Upstream's client
 * treats it as connection-level and dies every pending request of the client,
 * so a body the server could not read would kill an unrelated open `Watch` on
 * the other protocol. It is re-expressed as a `ClientProtocolError` naming the
 * requests its protocol still owes an answer to.
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
import { RpcClientDefect, RpcClientError } from "effect/rpc/RpcClientError";
import type {
  FromClientEncoded,
  FromServerEncoded,
  ResponseDefectEncoded,
} from "effect/rpc/RpcMessage";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Schema from "effect/Schema";

/** The frames one POST may carry; a burst past it is split across POSTs. */
const defaultMaxBatchFrames = 32;

/** A frame whose own body exceeds this travels alone, where it fails alone. */
const defaultMaxSingleFrameBytes = 64 * 1024;

/** How long a flush waits for the frames that start behind the first one. */
const defaultBatchWindow = Duration.millis(2);

/** The response writer the client binds to one client id for `run`. */
type WriteResponse = (message: FromServerEncoded) => Effect.Effect<void>;

/**
 * One protocol and, per client id, the requests it has sent and not yet seen
 * answered.
 *
 * The scope is the protocol *and* the client because neither is enough on its
 * own. Two clients share one protocol whenever they share the runtime layer —
 * the dashboard's promise runtime and its `AtomRpc` runtimes do — and a failure
 * that names one client's requests clears the other's tracking if they share a
 * set. Within a client, the protocol is the finest scope upstream offers: it
 * reports nothing about which POST a frame arrived on.
 */
interface Routed {
  readonly protocol: RpcClient.Protocol["Service"];
  readonly pending: Map<number, Set<string | number>>;
}

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
    const batched: Routed = {
      pending: new Map(),
      protocol: yield* RpcClient.makeProtocolHttp(client, {
        batch: {
          window: options.batchWindow ?? defaultBatchWindow,
          maxSize: Math.max(1, options.maxBatchFrames ?? defaultMaxBatchFrames),
        },
      }).pipe(
        Effect.provideService(RpcSerialization.RpcSerialization, serialization)
      ),
    };
    const alone: Routed = {
      pending: new Map(),
      protocol: yield* RpcClient.makeProtocolHttp(client).pipe(
        Effect.provideService(RpcSerialization.RpcSerialization, serialization)
      ),
    };

    /**
     * The requests `clientId` has in flight through `routed`, created on first
     * use and dropped when that client's `run` ends.
     */
    const pendingFor = (
      routed: Routed,
      clientId: number
    ): Set<string | number> => {
      const existing = routed.pending.get(clientId);
      if (existing !== undefined) {
        return existing;
      }
      const created = new Set<string | number>();
      routed.pending.set(clientId, created);
      return created;
    };

    const encodeText = new TextEncoder();
    const decodeDefect = Schema.decodeUnknownEffect(
      serialization.codecFor(Schema.Defect())
    );

    /**
     * The cause the server reported, as the failure a caller sees. Decoded with
     * the protocol's own codec so the caller gets the error the server meant
     * rather than the frame that carried it; a frame the codec cannot read
     * stays as it came.
     */
    const serverDefect = (
      frame: ResponseDefectEncoded
    ): Effect.Effect<RpcClientError> =>
      decodeDefect(frame.defect).pipe(
        Effect.match({
          onFailure: () =>
            new RpcClientError({
              reason: new RpcClientDefect({
                message: "The RPC server reported a defect",
                cause: frame.defect,
              }),
            }),
          onSuccess: (decoded) =>
            new RpcClientError({
              reason: new RpcClientDefect({
                message: "The RPC server reported a defect",
                cause: decoded,
              }),
            }),
        })
      );

    /**
     * The writer one protocol's responses go through.
     *
     * A `Defect` frame is connection-level in the client's model: receiving one
     * dies *every* pending request for the client, including an open `Watch`
     * that this POST had nothing to do with. Over HTTP a defect only says the
     * server could not read the body that carried it, so it is re-expressed as
     * a `ClientProtocolError` — the frame clients create locally to fail the
     * requests it names — limited to the exchanges this protocol still owes an
     * answer to. Every other frame goes through untouched.
     */
    const writerFor = (
      routed: Routed,
      clientId: number,
      writeResponse: WriteResponse
    ): WriteResponse => {
      const pending = pendingFor(routed, clientId);
      return (message) => {
        switch (message._tag) {
          case "Exit": {
            pending.delete(message.requestId);
            return writeResponse(message);
          }
          case "Defect": {
            const requestIds = [...pending];
            pending.clear();
            return Effect.flatMap(serverDefect(message), (error) =>
              writeResponse({
                _tag: "ClientProtocolError",
                error,
                requestIds,
              })
            );
          }
          case "ClientProtocolError": {
            if (message.requestIds === undefined) {
              pending.clear();
            } else {
              for (const requestId of message.requestIds) {
                pending.delete(requestId);
              }
            }
            return writeResponse(message);
          }
          default: {
            return writeResponse(message);
          }
        }
      };
    };

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
    const protocolFor = (request: FromClientEncoded): Effect.Effect<Routed> =>
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
          batched.protocol.run(
            clientId,
            writerFor(batched, clientId, writeResponse)
          ),
          alone.protocol.run(
            clientId,
            writerFor(alone, clientId, writeResponse)
          ),
        ]).pipe(
          // A client's tracker lives exactly as long as that client's run.
          Effect.ensuring(
            Effect.sync(() => {
              batched.pending.delete(clientId);
              alone.pending.delete(clientId);
            })
          )
        ),
      send: (clientId, request, transferables) =>
        Effect.flatMap(protocolFor(request), (routed) => {
          if (request._tag !== "Request") {
            return routed.protocol.send(clientId, request, transferables);
          }
          // Registered before the frame leaves, so an answer that arrives
          // during `send` still has its request in the set the writer scopes a
          // defect to, and released when `send` ends — including when an
          // interrupted caller ends it early, which no frame will report.
          const pending = pendingFor(routed, clientId);
          pending.add(request.id);
          return routed.protocol
            .send(clientId, request, transferables)
            .pipe(
              Effect.ensuring(Effect.sync(() => pending.delete(request.id)))
            );
        }),
      supportsAck: batched.protocol.supportsAck,
      supportsTransferables: batched.protocol.supportsTransferables,
      codecFor: batched.protocol.codecFor,
    };
  });

export const layerProtocolHttpBatch = (
  options: ProtocolHttpBatchOptions
): Layer.Layer<
  RpcClient.Protocol,
  never,
  RpcSerialization.RpcSerialization | HttpClient.HttpClient
> => Layer.effect(RpcClient.Protocol, makeProtocolHttpBatch(options));
