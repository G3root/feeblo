import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Headers from "effect/http/Headers";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as Option from "effect/Option";

import { Api } from "../http/api";
import { isBotUserAgent } from "./bot";
import { PostTrafficRepository } from "./repository";
import { parseUserAgent } from "./user-agent";

/** Cloudflare's country header is an ISO 3166-1 alpha-2 code, uppercase. */
const COUNTRY_PATTERN = /^[A-Z]{2}$/;

const header = (
  request: HttpServerRequest.HttpServerRequest,
  name: string
): string => Option.getOrElse(Headers.get(request.headers, name), () => "");

/**
 * Ingest one view.
 *
 * The response is the same whether the view was stored, deduplicated, or
 * discarded: the endpoint is public, and a caller must not be able to probe
 * which post ids exist or which boards are public. Failures are logged and
 * swallowed for the same reason — a page view is not worth an error a page can
 * act on.
 */
export const PostTrafficApiLive = HttpApiBuilder.group(
  Api,
  "PostTrafficApiGroup",
  (handlers) =>
    handlers.handle("recordPostView", ({ payload }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        // The relay forwards both in the body because a runtime may rewrite
        // the outbound `User-Agent`; a direct caller still gets the header
        // fallback.
        const userAgent = payload.userAgent ?? header(request, "user-agent");

        if (isBotUserAgent(userAgent)) {
          return { accepted: true };
        }

        const country = payload.country ?? header(request, "cf-ipcountry");
        const repository = yield* PostTrafficRepository;

        yield* repository.recordView({
          ...parseUserAgent(userAgent),
          country: COUNTRY_PATTERN.test(country) ? country : "",
          id: payload.id,
          postId: payload.postId,
        });

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
