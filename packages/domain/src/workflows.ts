import { Mailer } from "@feeblo/transactional/mailer";
import * as Layer from "effect/Layer";
import {
  ClusterWorkflowEngine,
  SingleRunner,
  TestRunner,
} from "effect/unstable/cluster";
import { EmailConfig } from "./email/config";
import { EmailReaperCron } from "./email/reaper";
import { EmailEventRepository } from "./email/repository";
import { PostStatusChangedEmailWorkflowLayer } from "./email/workflow";
import { SubmissionEmailNotificationWorkflowLayer } from "./post/workflow";
import { WelcomeUserWorkflowLayer } from "./user/workflows";

const WorkflowClusterEngineLive = ClusterWorkflowEngine.layer.pipe(
  Layer.provideMerge(SingleRunner.layer())
);

const WorkflowClusterEngineTest = ClusterWorkflowEngine.layer.pipe(
  Layer.provideMerge(TestRunner.layer)
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
    PostStatusChangedEmailWorkflowLayer.pipe(
      Layer.provide(makeMailerLayer()),
      Layer.provide(EmailEventRepository.layer),
      Layer.provide(EmailConfig.layer)
    )
  );

export const makeWorkflowsLive = (
  makeMailerLayer: MakeMailerLayer = () => Mailer.layer
) =>
  makeWorkflowLayers(makeMailerLayer).pipe(
    // Merge order matters: `provideMerge` only subtracts the dependency's own
    // services, so each requirement must be satisfied by a layer merged after
    // the layer that introduces it.
    Layer.provideMerge(EmailReaperCron),
    Layer.provideMerge(EmailEventRepository.layer),
    Layer.provideMerge(WorkflowClusterEngineLive)
  );

export const WorkflowsLive = makeWorkflowsLive();

export const makeWorkflowsTest = (
  makeMailerLayer: MakeMailerLayer = () => Mailer.layer
) =>
  makeWorkflowLayers(makeMailerLayer).pipe(
    Layer.provideMerge(WorkflowClusterEngineTest)
  );
