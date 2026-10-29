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
      // The API's own origin. The MCP surface needs it to resolve the relative
      // request URL Effect exposes into the absolute URL a token verifier
      // expects (DPoP binds a proof to `htu`, which must be absolute).
      const apiUrl = yield* Config.schema(Schema.URLFromString, "API_URL");
      return {
        appUrl: appUrl.href.replace(trailingSlashPattern, ""),
        apiUrl: apiUrl.href.replace(trailingSlashPattern, ""),
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);

  /** Supplies already-validated URLs to tests. */
  static readonly layerTest = (
    appUrl: URL,
    apiUrl: URL = new URL("https://api.feeblo.test")
  ) =>
    Layer.succeed(
      this,
      this.of({
        appUrl: appUrl.href.replace(trailingSlashPattern, ""),
        apiUrl: apiUrl.href.replace(trailingSlashPattern, ""),
      })
    );
}
