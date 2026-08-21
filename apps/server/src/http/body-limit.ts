import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { MAX_REQUEST_BODY_BYTES } from "./constants";

export const requestBodyTooLargeResponse = (): Response =>
  new Response("Request body too large", { status: 413 });

export const handleBetterAuthRequest = async ({
  handler,
  headers,
  request,
}: {
  readonly handler: (request: Request) => Promise<Response> | Response;
  readonly headers: Headers;
  readonly request: Request;
}): Promise<Response> => {
  // Missing or non-numeric Content-Length values parse to NaN and fall
  // through to the streaming body-size guard below; only finite lengths above
  // the cap are rejected up front.
  const declaredLength = Number(headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_REQUEST_BODY_BYTES
  ) {
    return requestBodyTooLargeResponse();
  }

  let bodyLimitExceeded = false;
  let bytesRead = 0;
  const sourceReader = request.body?.getReader();
  const body = sourceReader
    ? new ReadableStream<Uint8Array>({
        async pull(controller) {
          const { done, value } = await sourceReader.read();
          if (done) {
            controller.close();
            return;
          }
          bytesRead += value.byteLength;
          if (bytesRead > MAX_REQUEST_BODY_BYTES) {
            bodyLimitExceeded = true;
            // Cancel the upstream body so an oversized upload stops being
            // read instead of streaming into this process indefinitely.
            // Don't error the downstream stream — that surfaces as an
            // unhandled stream error inside Better Auth and gets logged as
            // `ERROR [Better Auth]: Request body too large`. Closing it with
            // a truncated body lets the handler finish; we override its
            // response with 413 below.
            void sourceReader.cancel().catch(() => {});
            controller.close();
            return;
          }
          controller.enqueue(value);
        },
        cancel(reason) {
          return sourceReader.cancel(reason).catch(() => {});
        },
      })
    : undefined;
  let limitedRequest: Request;
  if (body) {
    const requestInit = { body, duplex: "half" as const, headers };
    limitedRequest = new Request(request, requestInit);
  } else {
    limitedRequest = new Request(request, { headers });
  }

  try {
    const response = await handler(limitedRequest);
    return bodyLimitExceeded ? requestBodyTooLargeResponse() : response;
  } catch (error) {
    if (bodyLimitExceeded) {
      return requestBodyTooLargeResponse();
    }
    throw error;
  }
};

/**
 * Limits every request body while it is read, including chunked requests that
 * omit Content-Length. Effect applies this reference to JSON, form and
 * multipart body readers before they buffer the payload.
 */
export const bodySizeLimitMiddleware = <E, R>(
  httpApp: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  E,
  R | HttpServerRequest.HttpServerRequest
> =>
  Effect.provideService(
    httpApp,
    HttpServerRequest.MaxBodySize,
    FileSystem.Size(MAX_REQUEST_BODY_BYTES)
  );
