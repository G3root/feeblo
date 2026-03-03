import { Rpc, RpcGroup } from "@effect/rpc";
import { AuthMiddleware } from "../session-middleware";
import { OnboardingServiceErrors } from "./errors";
import { CompleteOnboardingInput, CompleteOnboardingOutput } from "./schema";

export class OnboardingRpcs extends RpcGroup.make(
  Rpc.make("OnboardingComplete", {
    payload: CompleteOnboardingInput,
    success: CompleteOnboardingOutput,
    error: OnboardingServiceErrors,
  }).middleware(AuthMiddleware)
) {}
