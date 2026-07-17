import * as Layer from "effect/Layer";
import { ClusterWorkflowEngine, SingleRunner } from "effect/unstable/cluster";
import { WelcomeUserWorkflowLayer } from "./user/workflows";

const WorkflowClusterEngineLive = ClusterWorkflowEngine.layer.pipe(
  Layer.provideMerge(SingleRunner.layer())
);

export const WorkflowsLive = Layer.mergeAll(WelcomeUserWorkflowLayer).pipe(
  Layer.provideMerge(WorkflowClusterEngineLive)
);
