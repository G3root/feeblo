import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { handleBetterAuthRequest } from "./body-limit";
import { MAX_REQUEST_BODY_BYTES } from "./constants";

const CHUNK_SIZE = 64 * 1024;

/**
 * A stand-in for a chunked upload with no Content-Length: it never ends on
 * its own, so a server that keeps reading after the body limit is hit will
 * pull from it forever.
 */
const makeUnboundedChunkedBody = (): {
  readonly stream: ReadableStream<Uint8Array>;
  readonly state: { bytesPulled: number; cancelled: boolean };
} => {
  const state = { bytesPulled: 0, cancelled: false };
  const chunk = new Uint8Array(CHUNK_SIZE);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.bytesPulled += chunk.byteLength;
      controller.enqueue(chunk);
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
};

describe("handleBetterAuthRequest", () => {
  it.live(
    "returns 413 and stops reading when a chunked client keeps sending past the limit",
    () =>
      Effect.promise(async () => {
        const { stream, state } = makeUnboundedChunkedBody();
        const requestInit = {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: stream,
          duplex: "half" as const,
        };
        const request = new Request(
          "http://localhost/api/auth/sign-in",
          requestInit
        );

        let handlerBodyBytes = 0;
        const response = await handleBetterAuthRequest({
          handler: async (limited) => {
            handlerBodyBytes = (await limited.arrayBuffer()).byteLength;
            return new Response("ok");
          },
          headers: request.headers,
          request,
        });

        expect(response.status).toBe(413);
        // The handler saw a truncated body instead of a stream error.
        expect(handlerBodyBytes).toBeLessThanOrEqual(MAX_REQUEST_BODY_BYTES);
        // The upstream was cancelled rather than drained forever. The source
        // may have buffered one chunk ahead of the consumer when the cancel
        // landed, so allow that much slack.
        expect(state.cancelled).toBe(true);
        expect(state.bytesPulled).toBeLessThanOrEqual(
          MAX_REQUEST_BODY_BYTES + 2 * CHUNK_SIZE
        );
      })
  );

  it.live("passes bodies under the limit through untouched", () =>
    Effect.promise(async () => {
      const payload = '{"hello":"world"}';
      const request = new Request("http://localhost/api/auth/get-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      });

      const response = await handleBetterAuthRequest({
        handler: async (limited) => new Response(await limited.text()),
        headers: request.headers,
        request,
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(payload);
    })
  );

  it.live(
    "rejects a declared Content-Length over the limit without calling the handler",
    () =>
      Effect.promise(async () => {
        const request = new Request("http://localhost/api/auth/sign-in", {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(MAX_REQUEST_BODY_BYTES + 1),
          },
          body: new Uint8Array(0),
        });

        let handlerCalled = false;
        const response = await handleBetterAuthRequest({
          handler: async () => {
            handlerCalled = true;
            return new Response("ok");
          },
          headers: request.headers,
          request,
        });

        expect(response.status).toBe(413);
        expect(handlerCalled).toBe(false);
      })
  );
});
