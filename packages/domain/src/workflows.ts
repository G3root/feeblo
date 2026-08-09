import { Mailer } from "@feeblo/transactional/mailer";
import { EntitlementPolicy } from "./entitlement/policies";
import { EmailSubscriptionRepository } from "./email-subscription/repository";
import { EmailOutboxRepository } from "./email-outbox/repository";
import { EmailOutboxWorkflowLayer, reconcileEmailOutbox } from "./email-outbox/workflow";
import * as Cron from "effect/Cron";
import * as Layer from "effect/Layer";
import {
  ClusterCron,
  ClusterWorkflowEngine,
  SingleRunner,
  TestRunner,
} from "effect/unstable/cluster";
import { SubmissionEmailNotificationWorkflowLayer } from "./post/workflow";
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
  cron: Cron.parseUnsafe("0 * * * * *"),
  execute: reconcileEmailOutbox(),
}).pipe(
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

const makeWorkflowLayers = (makeMailerLayer: MakeMailerLayer) =>
  Layer.mergeAll(
    WelcomeUserWorkflowLayer.pipe(Layer.provide(makeMailerLayer())),
    SubmissionEmailNotificationWorkflowLayer.pipe(
      Layer.provide(makeMailerLayer())
    ),
    EmailOutboxWorkflowLayer.pipe(
      Layer.provide(makeMailerLayer()),
      Layer.provide(EmailOutboxRepository.layer),
      Layer.provide(
        EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
      )
    ),
    EmailOutboxReconciliationLayer
  );

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
