import * as Context from "effect/Context";

/** Deployment GitHub App configuration held outside connection and route JSON. */
export interface GitHubIntegrationConfigShape {
  /** GitHub App client identifier; never persisted in integration JSON. */
  readonly clientId: string;
  readonly configured: boolean;
  /** GitHub App setup callback URL; does not include any secret. */
  readonly oauthRedirectUrl: string;
  /** Public GitHub App webhook URL; the App has one global webhook endpoint. */
  readonly webhookUrl: string;
}

/** Server configuration capability for GitHub App setup; secrets remain in its implementation only. */
export class GitHubIntegrationConfig extends Context.Service<
  GitHubIntegrationConfig,
  GitHubIntegrationConfigShape
>()("@feeblo/GitHubIntegrationConfig") {}
