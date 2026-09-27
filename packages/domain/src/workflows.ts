import { MailerConfig } from "@feeblo/transactional/config";
import { Mailer } from "@feeblo/transactional/mailer";
import * as Cron from "effect/Cron";
import * as Layer from "effect/Layer";
import {
  ClusterCron,
  ClusterWorkflowEngine,
  SingleRunner,
  TestRunner,
} from "effect/unstable/cluster";
import * as PersistedQueue from "effect/unstable/persistence/PersistedQueue";

import { EmailOutboxConfig } from "./email-outbox/config";
import {
  EmailOutboxQueues,
  EmailOutboxWorkerLayer,
  reconcileEmailOutbox,
} from "./email-outbox/queue";
import { EmailOutboxRepository } from "./email-outbox/repository";
import { EmailSubscriptionRepository } from "./email-subscription/repository";
import { EntitlementPolicy } from "./entitlement/policies";
import { WelcomeUserWorkflowLayer } from "./user/workflows";
import { WorkspaceRepository } from "./workspace/repository";

// `WelcomeUserWorkflow` stays on the cluster workflow engine. Its two hour and
// six day waits are durable timers, and a persisted queue has no scheduled
// delivery: an element becomes visible again only through a retry schedule,
// which is driven by the attempt count rather than by a wall-clock instant.
const WorkflowClusterEngineLive = ClusterWorkflowEngine.layer.pipe(
  Layer.provideMerge(SingleRunner.layer())
);

const WorkflowClusterEngineTest = ClusterWorkflowEngine.layer.pipe(
  Layer.provideMerge(TestRunner.layer)
);

/**
 * Drives the outbox queues.
 *
 * The email outbox materializes intents and retries deliveries off the rows
 * themselves (`scheduled_at`, `next_attempt_at`), so reconciliation is the only
 * scheduler.
 *
 * Behaviour change from the workflow engine: `DurableClock` slept to
 * `scheduled_at` exactly, and this sweep only sees the row once a minute. That
 * coarsens one case — the five minute post-status coalescing window — by up to
 * a minute. In exchange, no worker slot is held for the length of a window, so
 * scheduling several intents ahead can no longer occupy every dispatcher. The
 * sweep itself is a bounded index read on `email_outbox_state_scheduledAt_idx`.
 */
const EmailOutboxReconciliationLayer = ClusterCron.make({
  name: "EmailOutboxReconciliation",
  cron: Cron.parseUnsafe("0 * * * * *"),
  execute: reconcileEmailOutbox(),
});

type MakeMailerLayer = () => Layer.Layer<
  Mailer,
  Layer.Error<typeof Mailer.layer>
>;

const makeEmailOutboxLayer = (makeMailerLayer: MakeMailerLayer) => {
  // One mailer layer shared by every worker so repeated calls cannot build
  // duplicate transports.
  const mailerLayer = makeMailerLayer();
  return Layer.mergeAll(
    EmailOutboxWorkerLayer,
    EmailOutboxReconciliationLayer
  ).pipe(
    Layer.provide(mailerLayer),
    Layer.provide(EmailOutboxConfig.layer),
    Layer.provide(EmailOutboxRepository.layer),
    Layer.provide(EmailSubscriptionRepository.layer),
    Layer.provide(
      EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
    )
  );
};

const makeWorkflowLayers = (makeMailerLayer: MakeMailerLayer) =>
  Layer.mergeAll(
    WelcomeUserWorkflowLayer.pipe(
      Layer.provide(makeMailerLayer()),
      Layer.provide(MailerConfig.layer)
    ),
    makeEmailOutboxLayer(makeMailerLayer)
  );

/**
 * The SQL store doubles as the queue's de-duplication record.
 *
 * `layerCleanup` trims completed elements after their TTL (30 days by default)
 * so `effect_queue` cannot grow without bound while offer de-duplication keeps
 * working across replays. The docs ask for it in one instance of a deployment,
 * which is what a single process here is.
 */
const PersistedQueueLive = Layer.mergeAll(
  PersistedQueue.layer,
  PersistedQueue.layerCleanup()
).pipe(Layer.provide(PersistedQueue.layerStoreSql()));

const PersistedQueueTest = PersistedQueue.layer.pipe(
  Layer.provide(PersistedQueue.layerStoreMemory)
);

export const makeWorkflowsLive = (
  makeMailerLayer: MakeMailerLayer = () => Mailer.layer
) =>
  makeWorkflowLayers(makeMailerLayer).pipe(
    Layer.provide(EmailOutboxQueues.layer),
    Layer.provide(PersistedQueueLive),
    Layer.provideMerge(WorkflowClusterEngineLive)
  );

export const WorkflowsLive = makeWorkflowsLive();

export const makeWorkflowsTest = (
  makeMailerLayer: MakeMailerLayer = () => Mailer.layer
) =>
  makeWorkflowLayers(makeMailerLayer).pipe(
    Layer.provide(EmailOutboxQueues.layer),
    Layer.provide(PersistedQueueTest),
    Layer.provideMerge(WorkflowClusterEngineTest)
  );
