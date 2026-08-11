import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

const trailingSlashPattern = /\/$/;

const AppUrl = Config.schema(Schema.URLFromString, "APP_URL");
const ApiUrl = Config.schema(Schema.URLFromString, "API_URL");
const GlobalDeliveryPaused = Config.boolean(
  "EMAIL_OUTBOX_GLOBAL_DELIVERY_PAUSED"
).pipe(Config.withDefault(false));
const MaxConcurrentSends = Config.number(
  "EMAIL_OUTBOX_MAX_CONCURRENT_SENDS"
).pipe(Config.withDefault(10));
const MonthlySendLimit = Config.number("EMAIL_OUTBOX_MONTHLY_SEND_LIMIT").pipe(
  Config.withDefault(100_000)
);
const EstimatedSendCostMicros = Config.number(
  "EMAIL_OUTBOX_ESTIMATED_SEND_COST_MICROS"
).pipe(Config.withDefault(100));
const PausedWorkspaceIds = Config.string(
  "EMAIL_OUTBOX_PAUSED_WORKSPACE_IDS"
).pipe(Config.withDefault(""));

/** Runtime URLs used when snapshotting links into email delivery payloads. */
export class EmailOutboxConfig extends Context.Service<EmailOutboxConfig>()(
  "EmailOutboxConfig",
  {
    make: Effect.gen(function* () {
      const appUrl = yield* AppUrl;
      const apiUrl = yield* ApiUrl;
      const globalDeliveryPaused = yield* GlobalDeliveryPaused;
      const maxConcurrentSends = yield* MaxConcurrentSends;
      const monthlySendLimit = yield* MonthlySendLimit;
      const estimatedSendCostMicros = yield* EstimatedSendCostMicros;
      const pausedWorkspaceIds = yield* PausedWorkspaceIds;
      return {
        apiUrl: apiUrl.href.replace(trailingSlashPattern, ""),
        appUrl: appUrl.href.replace(trailingSlashPattern, ""),
        estimatedSendCostMicros: Math.max(0, estimatedSendCostMicros),
        globalDeliveryPaused,
        maxConcurrentSends: Math.max(1, maxConcurrentSends),
        monthlySendLimit: Math.max(1, monthlySendLimit),
        pausedWorkspaceIds: new Set(
          pausedWorkspaceIds
            .split(",")
            .map((id) => id.trim())
            .filter((id) => id.length > 0)
        ),
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);

  /** Supplies an already-validated application URL to tests. */
  static readonly layerTest = (
    appUrl: URL,
    apiUrl = appUrl,
    controls: {
      readonly estimatedSendCostMicros?: number;
      readonly globalDeliveryPaused?: boolean;
      readonly maxConcurrentSends?: number;
      readonly monthlySendLimit?: number;
      readonly pausedWorkspaceIds?: ReadonlySet<string>;
    } = {}
  ) =>
    Layer.succeed(
      this,
      this.of({
        apiUrl: apiUrl.href.replace(trailingSlashPattern, ""),
        appUrl: appUrl.href.replace(trailingSlashPattern, ""),
        estimatedSendCostMicros: controls.estimatedSendCostMicros ?? 100,
        globalDeliveryPaused: controls.globalDeliveryPaused ?? false,
        maxConcurrentSends: controls.maxConcurrentSends ?? 10,
        monthlySendLimit: controls.monthlySendLimit ?? 100_000,
        pausedWorkspaceIds: new Set(
          controls.pausedWorkspaceIds ?? new Set<string>()
        ),
      })
    );
}
