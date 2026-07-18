import { Mailer } from "@feeblo/transactional/mailer";
import * as Layer from "effect/Layer";
import {
  ClusterWorkflowEngine,
  SingleRunner,
  TestRunner,
} from "effect/unstable/cluster";
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
    )
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
