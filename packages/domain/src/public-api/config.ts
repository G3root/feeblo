import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

const trailingSlashPattern = /\/$/;

/**
 * Runtime URLs the Public API needs to compose response links.
 *
 * Only `appUrl` is required: a post's `url` points at the public board, which
 * is served by the dashboard application, not by the API itself.
 */
export class PublicApiConfig extends Context.Service<PublicApiConfig>()(
  "PublicApiConfig",
  {
    make: Effect.gen(function* () {
      const appUrl = yield* Config.schema(Schema.URLFromString, "APP_URL");
      return { appUrl: appUrl.href.replace(trailingSlashPattern, "") } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);

  /** Supplies an already-validated application URL to tests. */
  static readonly layerTest = (appUrl: URL) =>
    Layer.succeed(
      this,
      this.of({ appUrl: appUrl.href.replace(trailingSlashPattern, "") })
    );
}

/**
 * Reads the config from the fiber context.
 *
 * `HttpApiBuilder` does not thread a handler's service requirements through the
 * route layer, so handlers take services from the context the composition
 * provides — the same shape as `currentHttpApiSession`.
 */
export const currentPublicApiConfig = Effect.context<never>().pipe(
  Effect.map((context) => Context.getUnsafe(context, PublicApiConfig))
);
