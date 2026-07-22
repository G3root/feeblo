import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { OgImagePostNotFoundError, OgImageSiteNotFoundError } from "./errors";
import { OgImageRepository } from "./repository";
import type { OgImageData, OgImageRequest } from "./schema";

const makeOgImageService = Effect.gen(function* () {
  const repository = yield* OgImageRepository;

  return {
    getData: Effect.fn("OgImageService.getData")(function* (
      input: OgImageRequest
    ): Effect.fn.Return<
      OgImageData,
      | EffectDrizzleQueryError
      | OgImagePostNotFoundError
      | OgImageSiteNotFoundError
    > {
      const siteOption = yield* repository.findSite(input.siteId);
      if (Option.isNone(siteOption)) {
        return yield* new OgImageSiteNotFoundError({ siteId: input.siteId });
      }

      const site = siteOption.value;
      if (input.type !== "post-detail") {
        return { siteName: site.name, type: input.type };
      }

      const postOption = yield* repository.findPost({
        organizationId: site.organizationId,
        postSlug: input.post,
      });
      if (Option.isNone(postOption)) {
        return yield* new OgImagePostNotFoundError({
          postSlug: input.post,
          siteId: input.siteId,
        });
      }

      return {
        ...postOption.value,
        siteName: site.name,
        type: "post-detail",
      } satisfies OgImageData;
    }),
  };
});

export class OgImageService extends Context.Service<OgImageService>()(
  "OgImageService",
  { make: makeOgImageService }
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(OgImageRepository.layer)
  );
}
