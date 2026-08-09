import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

const AppUrl = Config.schema(Schema.URLFromString, "APP_URL");

/** Runtime URLs used when snapshotting links into email delivery payloads. */
export class EmailOutboxConfig extends Context.Service<EmailOutboxConfig>()(
  "EmailOutboxConfig",
  {
    make: Effect.gen(function* () {
      const appUrl = yield* AppUrl;
      return { appUrl: appUrl.href.replace(/\/$/, "") } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);

  /** Supplies an already-validated application URL to tests. */
  static readonly layerTest = (appUrl: URL) =>
    Layer.succeed(
      this,
      this.of({ appUrl: appUrl.href.replace(/\/$/, "") })
    );
}
