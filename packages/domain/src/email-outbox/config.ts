import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

const trailingSlashPattern = /\/$/;

/**
 * Submission-notification window bounds.
 *
 * New submissions do not each send an email. They accumulate in one pending
 * outbox intent per workspace, whose `scheduledAt` slides on every append, so a
 * burst of submissions produces a single email `submissionWindowBurst` after
 * the last one. `submissionWindowCeiling` stops that slide, bounding a
 * sustained flood to one email per workspace per hour instead of one per post.
 *
 * These are module constants rather than environment, and the window is
 * maintained by `EmailOutboxRepository` rather than by `EmailOutboxConfig`:
 * they are a safety property of the outbox, and keeping them out of the
 * service keeps the repository free of a config requirement.
 */
export const submissionWindowBurst = Duration.minutes(5);
/** Hard bound on how far one window's send may slide, from its creation. */
export const submissionWindowCeiling = Duration.hours(1);
/**
 * Most posts one window stores. A window past this keeps counting without
 * storing, so overflowing it cannot open a second window and double the rate.
 */
export const submissionWindowMaxPosts = 200;

const AppUrl = Config.schema(Schema.URLFromString, "APP_URL");
const ApiUrl = Config.schema(Schema.URLFromString, "API_URL");
const GlobalDeliveryPaused = Config.Boolean(
  "EMAIL_OUTBOX_GLOBAL_DELIVERY_PAUSED"
).pipe(Config.withDefault(false));
const MaxConcurrentSends = Config.Number(
  "EMAIL_OUTBOX_MAX_CONCURRENT_SENDS"
).pipe(Config.withDefault(10));
const MonthlySendLimit = Config.Number("EMAIL_OUTBOX_MONTHLY_SEND_LIMIT").pipe(
  Config.withDefault(100_000)
);
const EstimatedSendCostMicros = Config.Number(
  "EMAIL_OUTBOX_ESTIMATED_SEND_COST_MICROS"
).pipe(Config.withDefault(100));
const WorkspaceMonthlySendLimit = Config.Number(
  "EMAIL_OUTBOX_WORKSPACE_MONTHLY_SEND_LIMIT"
).pipe(Config.withDefault(25_000));
const PausedWorkspaceIds = Config.String(
  "EMAIL_OUTBOX_PAUSED_WORKSPACE_IDS"
).pipe(Config.withDefault(""));
const AppRootDomain = Config.String("APP_ROOT_DOMAIN").pipe(
  Config.withDefault("")
);

const resolveAppRootDomain = (appUrl: URL, configured: string): string => {
  if (configured.trim().length > 0) {
    return configured.replace(trailingSlashPattern, "");
  }
  // Fallback to the host of APP_URL (e.g. https://test.feeblo.example → test.feeblo.example)
  // so local/test environments still build a usable public subdomain URL.
  return appUrl.host;
};

/** Runtime URLs used when snapshotting links into email delivery payloads. */
export class EmailOutboxConfig extends Context.Service<EmailOutboxConfig>()(
  "EmailOutboxConfig",
  {
    make: Effect.gen(function* () {
      const appUrl = yield* AppUrl;
      const apiUrl = yield* ApiUrl;
      const configuredRootDomain = yield* AppRootDomain;
      const globalDeliveryPaused = yield* GlobalDeliveryPaused;
      const maxConcurrentSends = yield* MaxConcurrentSends;
      const monthlySendLimit = yield* MonthlySendLimit;
      const estimatedSendCostMicros = yield* EstimatedSendCostMicros;
      const pausedWorkspaceIds = yield* PausedWorkspaceIds;
      const workspaceMonthlySendLimit = yield* WorkspaceMonthlySendLimit;
      return {
        apiUrl: apiUrl.href.replace(trailingSlashPattern, ""),
        appUrl: appUrl.href.replace(trailingSlashPattern, ""),
        appRootDomain: resolveAppRootDomain(appUrl, configuredRootDomain),
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
        workspaceMonthlySendLimit: Math.max(1, workspaceMonthlySendLimit),
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
      readonly appRootDomain?: string;
      readonly estimatedSendCostMicros?: number;
      readonly globalDeliveryPaused?: boolean;
      readonly maxConcurrentSends?: number;
      readonly monthlySendLimit?: number;
      readonly pausedWorkspaceIds?: ReadonlySet<string>;
      readonly workspaceMonthlySendLimit?: number;
    } = {}
  ) =>
    Layer.succeed(
      this,
      this.of({
        apiUrl: apiUrl.href.replace(trailingSlashPattern, ""),
        appUrl: appUrl.href.replace(trailingSlashPattern, ""),
        appRootDomain:
          controls.appRootDomain ?? resolveAppRootDomain(appUrl, ""),
        estimatedSendCostMicros: controls.estimatedSendCostMicros ?? 100,
        globalDeliveryPaused: controls.globalDeliveryPaused ?? false,
        maxConcurrentSends: controls.maxConcurrentSends ?? 10,
        monthlySendLimit: controls.monthlySendLimit ?? 100_000,
        pausedWorkspaceIds: new Set(
          controls.pausedWorkspaceIds ?? new Set<string>()
        ),
        workspaceMonthlySendLimit: controls.workspaceMonthlySendLimit ?? 25_000,
      })
    );
}
