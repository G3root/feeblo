import { Mailer } from "@feeblo/transactional/mailer";
import * as Layer from "effect/Layer";
import { ClusterWorkflowEngine, SingleRunner } from "effect/unstable/cluster";
import { SubmissionEmailNotificationWorkflowLayer } from "./post/workflow";
import { WelcomeUserWorkflowLayer } from "./user/workflows";

const WorkflowClusterEngineLive = ClusterWorkflowEngine.layer.pipe(
  Layer.provideMerge(SingleRunner.layer())
);

export const WorkflowsLive = Layer.mergeAll(
  WelcomeUserWorkflowLayer,
  SubmissionEmailNotificationWorkflowLayer.pipe(Layer.provide(Mailer.layer))
).pipe(Layer.provideMerge(WorkflowClusterEngineLive));
