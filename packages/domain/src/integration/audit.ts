import type {
  TAuditAction,
  TAuditChanges,
  TAuditMetadata,
} from "@feeblo/domain-contracts/audit";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import { actorFromSession } from "../audit-log/attribution";
import { AuditLogRecorder, type TAuditActorRef } from "../audit-log/recorder";
import { CurrentSession } from "../session-middleware";

/**
 * The provider actions an operator can take: webhook endpoint configuration and
 * the integration connections themselves.
 *
 * Delivery attempts are deliberately absent. A retry or a test delivery is a
 * delivery operation, not a change to the workspace's configuration, and
 * `docs/audit-log.md` leaves delivery attempts out of the log on purpose.
 */
type TProviderAuditAction = Extract<
  TAuditAction,
  `integration.${string}` | `webhook.${string}`
>;

/**
 * The dashboard operator behind the provider mutation in flight.
 *
 * A provider write lives in its provider package — the webhook endpoint
 * service, the chat connection services, the GitHub adapter — because the
 * transaction that changes the workspace belongs there and not in the RPC
 * handler that authorized it. The handler is the only place that holds the
 * session, and the service is the only place that holds the transaction, so the
 * actor crosses between them in context instead of through the management
 * contracts, which are the wire shapes of the RPC payloads.
 *
 * A `Context.Reference` defaulting to `null`, like `PublicRpcRateLimiter`: the
 * same service methods also run from OAuth callbacks and provider webhooks,
 * where there is no dashboard session and therefore nothing to attribute. Those
 * paths write no entry rather than borrowing an actor, because a member's name
 * on a callback they never made is worse than no row.
 */
export class IntegrationAuditActor extends Context.Reference<TAuditActorRef | null>(
  "@feeblo/domain/integration/IntegrationAuditActor",
  { defaultValue: () => null }
) {}

/**
 * Runs one dashboard management call with its operator in context.
 *
 * The entry itself is written by {@link recordProviderChange} inside the
 * provider's own transaction, so the entry and the configuration change commit
 * together.
 */
export const withProviderAudit = <A, E, R>(
  organizationId: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | CurrentSession> =>
  Effect.gen(function* () {
    const session = yield* CurrentSession;
    return yield* effect.pipe(
      Effect.provideService(
        IntegrationAuditActor,
        actorFromSession(session, organizationId)
      )
    );
  });

/**
 * Appends one provider entry.
 *
 * Takes the recorder as a value rather than yielding it: a service layer reads
 * it once while building the service, so the methods it hands out stay free of
 * a requirement their management contract does not declare. Call it inside the
 * provider's transaction, next to the write it describes: it is `record`, not
 * `recordBestEffort`, so a failed insert aborts the change instead of leaving a
 * change with no explanation of who made it.
 *
 * It does nothing when no dashboard actor is in context (an OAuth callback or a
 * provider webhook), which is why the call site needs no branch of its own.
 *
 * `metadata` carries the provider and the setting names. A signing secret, an
 * OAuth nonce or an installer token never reaches this function — the recorder
 * redacts credential-shaped keys as a backstop, but the call site is what owes
 * the truth.
 */
export const recordProviderChange = (
  audit: AuditLogRecorder["Service"],
  {
    organizationId,
    action,
    connectionId,
    changes,
    metadata,
  }: {
    readonly organizationId: string;
    readonly action: TProviderAuditAction;
    readonly connectionId?: string | undefined;
    /** Only when the call site holds the row the write replaced. */
    readonly changes?: TAuditChanges | undefined;
    readonly metadata?: TAuditMetadata | undefined;
  }
) =>
  Effect.gen(function* () {
    const actor = yield* IntegrationAuditActor;
    if (actor === null) {
      return;
    }
    yield* audit.record({
      organizationId,
      actor,
      source: "dashboard",
      action,
      ...(connectionId === undefined
        ? undefined
        : { resourceId: connectionId }),
      ...(changes === undefined ? undefined : { changes }),
      ...(metadata === undefined ? undefined : { metadata }),
    });
  });
