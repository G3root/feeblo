import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Headers from "effect/http/Headers";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as Option from "effect/Option";

import {
  ClientIp,
  ClientIpProxyTrustNone,
  type ClientIpValue,
  getClientIpFromRequest,
} from "../client-ip";
import { Api } from "../http/api";
import * as RateLimit from "../rate-limit";
import { isBotUserAgent } from "./bot";
import { PostTrafficRepository } from "./repository";
import { parseUserAgent } from "./user-agent";

/** Cloudflare's country header is an ISO 3166-1 alpha-2 code, uppercase. */
const COUNTRY_PATTERN = /^[A-Z]{2}$/;

/** A reader opening posts by hand is far below this; a loop is not. */
const VIEW_RATE_LIMIT = 120;

const header = (
  request: HttpServerRequest.HttpServerRequest,
  name: string
): string => Option.getOrElse(Headers.get(request.headers, name), () => "");

/**
 * The visitor address when the request crossed the configured proxy trust
 * boundary, or `undefined` when `ClientIp` is only the network peer.
 *
 * Resolving the peer a second time with no trust at all is what separates "the
 * relay forwarded a visitor" from "the relay is the visitor". Limiting by the
 * relay's own address would put every customer in one bucket, and trusting
 * the body's address would let any caller choose its own bucket; both are
 * refused here, and a request outside the boundary is simply not IP-limited.
 */
const forwardedClientAddress = (
  request: HttpServerRequest.HttpServerRequest,
  resolved: ClientIpValue
): string | undefined => {
  const peer = getClientIpFromRequest(request, ClientIpProxyTrustNone);
  if (resolved._tag !== "ClientIpAddress" || peer._tag !== "ClientIpAddress") {
    return undefined;
  }
  return resolved.address === peer.address ? undefined : resolved.address;
};

/**
 * Ingest one view.
 *
 * The response is the same whether the view was stored, rate-limited,
 * deduplicated, or discarded: the endpoint is public, and a caller must not be
 * able to probe which post ids exist, which boards are public, or how close it
 * is to a limit. Failures are logged and swallowed for the same reason — a page
 * view is not worth an error a page can act on.
 */
export const PostTrafficApiLive = HttpApiBuilder.group(
  Api,
  "PostTrafficApiGroup",
  (handlers) =>
    handlers.handle("recordPostView", ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const resolvedClientIp = yield* ClientIp;
        const forwarded = forwardedClientAddress(request, resolvedClientIp);

        // The relay forwards both in the body because a runtime may rewrite
        // the outbound `User-Agent`; a direct caller still gets the header
        // fallback.
        const userAgent = payload.userAgent ?? header(request, "user-agent");

        if (isBotUserAgent(userAgent)) {
          return { accepted: true };
        }

        // Edge data is trusted only from the relay boundary. A direct caller
        // cannot name its own country by putting one in the body.
        const country =
          forwarded === undefined
            ? ""
            : (payload.country ?? header(request, "cf-ipcountry"));

        const repository = yield* PostTrafficRepository;
        const record = repository.recordView({
          ...parseUserAgent(userAgent, payload.deviceHint),
          country: COUNTRY_PATTERN.test(country) ? country : "",
          id: payload.id,
          postId: payload.postId,
        });

        if (forwarded === undefined) {
          // No proven visitor address: record, but do not invent a bucket.
          yield* record;
        } else {
          yield* record.pipe(
            RateLimit.withPublicHttpRateLimit({
              name: "PostTrafficView",
              level: "write",
              limit: VIEW_RATE_LIMIT,
            }),
            // Over the limit or without a limiter, the caller still sees the
            // same accepted response and the view is dropped.
            Effect.catchTags({
              RateLimitExceededError: () => Effect.succeed(false),
              RateLimitUnavailableError: () => Effect.succeed(false),
            })
          );
        }

        return { accepted: true };
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("post view not recorded", error).pipe(
            Effect.as({ accepted: true })
          )
        )
      )
    )
);
