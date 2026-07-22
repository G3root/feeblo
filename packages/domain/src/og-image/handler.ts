import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import {
  type OgImagePostNotFoundError,
  type OgImageRenderError,
  OgImageRequestValidationError,
  type OgImageSiteNotFoundError,
} from "./errors";
import { generateOgImage } from "./og-image";
import { OgImageRequest } from "./schema";
import { OgImageService } from "./service";

const imageResponse = (image: Uint8Array) =>
  HttpServerResponse.uint8Array(image, {
    contentType: "image/png",
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
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
    const imageData = yield* service.getData(input);
    return imageResponse(yield* generateOgImage(imageData));
  });

export const handleOgImage = (
  request: HttpServerRequest.HttpServerRequest
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  OgImageService
> =>
  handleOgImageEffect(request).pipe(
    Effect.catchTag("OgImagePostNotFoundError", () =>
      Effect.succeed(HttpServerResponse.text("Post not found", { status: 404 }))
    ),
    Effect.catchTag("OgImageRenderError", () =>
      Effect.succeed(
        HttpServerResponse.text("Unable to render OG image", { status: 500 })
      )
    ),
    Effect.catchTag("OgImageRequestValidationError", (error) =>
      Effect.succeed(HttpServerResponse.text(error.message, { status: 400 }))
    ),
    Effect.catchTag("OgImageSiteNotFoundError", () =>
      Effect.succeed(HttpServerResponse.text("Site not found", { status: 404 }))
    ),
    Effect.orDie
  );
