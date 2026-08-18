import * as Context from "effect/Context";

/** Deployment GitHub App configuration held outside connection and route JSON. */
export interface GitHubIntegrationConfigContract {
  /** GitHub App client identifier; never persisted in integration JSON. */
  readonly clientId: string;
  readonly configured: boolean;
}

/** Server configuration capability for GitHub App setup; secrets remain in its implementation only. */
export class GitHubIntegrationConfig extends Context.Service<
  GitHubIntegrationConfig,
  GitHubIntegrationConfigContract
>()("@feeblo/GitHubIntegrationConfig") {}
