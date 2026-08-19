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
  const declaredLength = Number(headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_REQUEST_BODY_BYTES
  ) {
    return requestBodyTooLargeResponse();
  }

  let bodyLimitExceeded = false;
  let bytesRead = 0;
  const body = request.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (bodyLimitExceeded) {
          return;
        }
        bytesRead += chunk.byteLength;
        if (bytesRead > MAX_REQUEST_BODY_BYTES) {
          bodyLimitExceeded = true;
          return;
        }
        controller.enqueue(chunk);
      },
    })
  );
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
