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

const WorkflowClusterEngineLive = ClusterWorkflowEngine.layer.pipe(
  Layer.provideMerge(SingleRunner.layer())
);

const WorkflowClusterEngineTest = ClusterWorkflowEngine.layer.pipe(
  Layer.provideMerge(TestRunner.layer)
);

const EmailOutboxReconciliationLayer = ClusterCron.make({
  name: "EmailOutboxReconciliation",
  cron: Cron.parseUnsafe("0 0 * * * *"),
  execute: reconcileEmailOutbox(),
});

type MakeMailerLayer = () => Layer.Layer<
  Mailer,
  Layer.Error<typeof Mailer.layer>
>;

const makeWorkflowLayers = (makeMailerLayer: MakeMailerLayer) => {
  // One mailer layer shared by every workflow and queue worker so repeated
  // calls cannot build duplicate transports.
  const mailerLayer = makeMailerLayer();
  return Layer.mergeAll(
    WelcomeUserWorkflowLayer.pipe(
      Layer.provide(mailerLayer),
      Layer.provide(MailerConfig.layer)
    ),
    EmailOutboxWorkerLayer,
    EmailOutboxReconciliationLayer
  ).pipe(
    Layer.provideMerge(EmailOutboxQueues.layer),
    Layer.provide(PersistedQueue.layer),
    Layer.provide(mailerLayer),
    Layer.provide(EmailOutboxConfig.layer),
    Layer.provide(EmailOutboxRepository.layer),
    Layer.provide(EmailSubscriptionRepository.layer),
    Layer.provide(
      EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
    )
  );
};

export const makeWorkflowsLive = (
  makeMailerLayer: MakeMailerLayer = () => Mailer.layer
) =>
  makeWorkflowLayers(makeMailerLayer).pipe(
    // The installed effect release has no queue cleanup job, so completed rows
    // stay in `effect_queue` as the de-duplication record.
    Layer.provide(PersistedQueue.layerStoreSql()),
    Layer.provideMerge(WorkflowClusterEngineLive)
  );

export const WorkflowsLive = makeWorkflowsLive();

export const makeWorkflowsTest = (
  makeMailerLayer: MakeMailerLayer = () => Mailer.layer
) =>
  makeWorkflowLayers(makeMailerLayer).pipe(
    Layer.provide(PersistedQueue.layerStoreMemory),
    Layer.provideMerge(WorkflowClusterEngineTest)
  );
