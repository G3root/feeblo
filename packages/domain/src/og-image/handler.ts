import { TTLCache } from "@isaacs/ttlcache";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { ClientIp } from "../client-ip";
import * as RateLimit from "../rate-limit";
import { RateLimitService } from "../rate-limit/service";
import {
  type OgImagePostNotFoundError,
  type OgImageRenderError,
  OgImageRequestValidationError,
  type OgImageSiteNotFoundError,
} from "./errors";
import { generateOgImage } from "./og-image";
import { OgImageRequest, type OgImageData } from "./schema";
import { OgImageService } from "./service";

const browserCacheDuration = Duration.hours(1);
const staleCacheDuration = Duration.days(1);
const cacheControl = [
  "public",
  `max-age=${Duration.toSeconds(browserCacheDuration)}`,
  `stale-while-revalidate=${Duration.toSeconds(staleCacheDuration)}`,
].join(", ");

const imageResponse = (image: Uint8Array) =>
  HttpServerResponse.uint8Array(image, {
    contentType: "image/png",
    headers: {
      "Cache-Control": cacheControl,
    },
  });

// Isolate-local memo for complete OG responses (DB lookups + render).
// Satori+resvg renders dominate cost and link unfurlers request the same
// URLs in bursts; browser/CDN `Cache-Control` remains the primary cache,
// this absorbs repeats within an isolate. Keyed by request parameters (not
// rendered data) so upvote-driven re-renders collapse into the TTL window
// instead of key-missing on every count change. Post-detail images embed
// live counts/titles, so they expire in minutes; site-main images only
// change on rename and keep for an hour. `@isaacs/ttlcache` handles expiry
// plus LRU eviction; only successful renders are stored, so 404s and rate
// limits always revalidate. Buffers are read-only after render.
// 50 entries: bursts hit the same few URLs, and values are 1200×630 PNGs
// (hundreds of KB each), so the cap stays far below worker/server memory
// pressure (~15MB worst case) while covering the hot set.
const RENDER_CACHE_MAX_ENTRIES = 50;
const MAIN_IMAGE_TTL_MS = 60 * 60 * 1_000;
const POST_DETAIL_TTL_MS = 5 * 60 * 1_000;

const ogImageCache = new TTLCache<string, Uint8Array>({
  max: RENDER_CACHE_MAX_ENTRIES,
});

const decodeRequest = (
  request: HttpServerRequest.HttpServerRequest
): Effect.Effect<typeof OgImageRequest.Type, OgImageRequestValidationError> => {
  const params = new URL(request.url, "http://localhost").searchParams;
  return Schema.decodeUnknownEffect(OgImageRequest)(
    Object.fromEntries(params.entries())
  ).pipe(
    Effect.mapError(
      () =>
        new OgImageRequestValidationError({
          message: "Invalid OG image parameters",
        })
    )
  );
};

type HandlerError =
  | EffectDrizzleQueryError
  | OgImagePostNotFoundError
  | OgImageRenderError
  | OgImageRequestValidationError
  | OgImageSiteNotFoundError;

const handleOgImageEffect = (
  request: HttpServerRequest.HttpServerRequest
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  HandlerError,
  OgImageService
> =>
  Effect.gen(function* () {
    const service = yield* OgImageService;
    const input = yield* decodeRequest(request);
    const cacheKey =
      input.type === "post-detail"
        ? `post-detail:${input.siteId}:${input.post}`
        : `${input.type}:${input.siteId}`;
    const cached = ogImageCache.get(cacheKey);
    if (cached !== undefined) {
      return imageResponse(cached);
    }
    const imageData: OgImageData = yield* service.getData(input);
    const image = yield* generateOgImage(imageData);
    ogImageCache.set(cacheKey, image, {
      ttl:
        input.type === "post-detail" ? POST_DETAIL_TTL_MS : MAIN_IMAGE_TTL_MS,
    });
    return imageResponse(image);
  });

export const handleOgImage = (
  request: HttpServerRequest.HttpServerRequest
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  ClientIp | OgImageService | RateLimitService
> =>
  Effect.gen(function* () {
    const rateLimitService = yield* RateLimitService;
    // The render is CPU-bound and this route is unauthenticated; an attacker
    // can bypass the browser/CDN cache headers by varying query parameters, so
    // consume a per-IP quota before touching the database or the renderer.
    return yield* Effect.provideService(
      handleOgImageEffect(request).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "OgImage",
          level: "expensive",
        }),
        Effect.catchTag("RateLimitExceededError", () =>
          Effect.succeed(
            HttpServerResponse.text("Too many requests", { status: 429 })
          )
        ),
        Effect.catchTag("RateLimitUnavailableError", () =>
          Effect.succeed(
            HttpServerResponse.text("Rate limiter unavailable", { status: 503 })
          )
        ),
        Effect.catchTag("OgImagePostNotFoundError", () =>
          Effect.succeed(
            HttpServerResponse.text("Post not found", { status: 404 })
          )
        ),
        Effect.catchTag("OgImageRenderError", () =>
          Effect.succeed(
            HttpServerResponse.text("Unable to render OG image", {
              status: 500,
            })
          )
        ),
        Effect.catchTag("OgImageRequestValidationError", (error) =>
          Effect.succeed(
            HttpServerResponse.text(error.message, { status: 400 })
          )
        ),
        Effect.catchTag("OgImageSiteNotFoundError", () =>
          Effect.succeed(
            HttpServerResponse.text("Site not found", { status: 404 })
          )
        ),
        Effect.orDie
      ),
      RateLimit.PublicRpcRateLimiter,
      RateLimit.makePublicRpcRateLimiter({
        clientIp: yield* ClientIp,
        rateLimitService,
      })
    );
  });
