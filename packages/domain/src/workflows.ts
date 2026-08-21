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

import { EmailOutboxConfig } from "./email-outbox/config";
import { EmailOutboxRepository } from "./email-outbox/repository";
import {
  EmailOutboxWorkflowLayer,
  reconcileEmailOutbox,
} from "./email-outbox/workflow";
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
}).pipe(
  Layer.provide(EmailOutboxConfig.layer),
  Layer.provide(EmailOutboxRepository.layer),
  Layer.provide(EmailSubscriptionRepository.layer),
  Layer.provide(
    EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
  )
);

type MakeMailerLayer = () => Layer.Layer<
  Mailer,
  Layer.Error<typeof Mailer.layer>
>;

const makeWorkflowLayers = (makeMailerLayer: MakeMailerLayer) => {
  // One mailer layer shared by every workflow so repeated calls cannot build
  // duplicate transports.
  const mailerLayer = makeMailerLayer();
  return Layer.mergeAll(
    WelcomeUserWorkflowLayer.pipe(
      Layer.provide(mailerLayer),
      Layer.provide(MailerConfig.layer)
    ),
    EmailOutboxWorkflowLayer.pipe(
      Layer.provide(mailerLayer),
      Layer.provide(EmailOutboxConfig.layer),
      Layer.provide(EmailOutboxRepository.layer),
      Layer.provide(EmailSubscriptionRepository.layer),
      Layer.provide(
        EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
      )
    ),
    EmailOutboxReconciliationLayer
  );
};

export const makeWorkflowsLive = (
  makeMailerLayer: MakeMailerLayer = () => Mailer.layer
) =>
  makeWorkflowLayers(makeMailerLayer).pipe(
    Layer.provideMerge(WorkflowClusterEngineLive)
  );

export const WorkflowsLive = makeWorkflowsLive();

export const makeWorkflowsTest = (
  makeMailerLayer: MakeMailerLayer = () => Mailer.layer
) =>
  makeWorkflowLayers(makeMailerLayer).pipe(
    Layer.provideMerge(WorkflowClusterEngineTest)
  );
