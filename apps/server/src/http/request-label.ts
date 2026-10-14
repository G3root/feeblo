import type * as HttpServerRequest from "effect/http/HttpServerRequest";

/**
 * Dynamic path segments are redacted to keep labels built from request paths
 * bounded: the SES feedback webhook embeds its signing token in the URL, and
 * other routes carry UUIDs and prefixed legids.
 */
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const legidPattern = /^[a-z]{2,}_[a-z0-9]{6,}$/i;

const redactIdentifierSegment = (segment: string): string =>
  uuidPattern.test(segment) || legidPattern.test(segment) ? ":id" : segment;

/** Request path with identifier and token segments redacted. */
export const redactedRequestPath = (
  request: HttpServerRequest.HttpServerRequest
): string => {
  const path = request.url.split("?")[0] ?? "";
  return path
    .replace(/^(\/email-provider\/ses\/).+$/, "$1:token")
    .split("/")
    .map(redactIdentifierSegment)
    .join("/");
};

/** Human-readable request label used to identify each timing entry. */
export const requestLabel = (
  request: HttpServerRequest.HttpServerRequest
): string => `${request.method} ${redactedRequestPath(request)}`;
