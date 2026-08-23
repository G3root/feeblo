import * as Context from "effect/Context";
import type * as Redacted from "effect/Redacted";

/**
 * Runtime Slack integration configuration: app credentials, the request
 * signing secret, the OAuth redirect URL, and the at-rest encryption key.
 * The server composition root supplies the values; secrets remain outside
 * connection and route JSON (see docs/adr/0002).
 */
export interface SlackIntegrationConfigContract {
  /** Dashboard base URL used for post-installation redirects. */
  readonly appUrl: string;
  readonly authorizeScopes: readonly string[];
  /** Slack App client identifier; never persisted in integration JSON. */
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted<string>;
  /**
   * True only when the OAuth client id, client secret, and request signing
   * secret are all configured; otherwise the deployment runs without Slack.
   */
  readonly configured: boolean;
  readonly encryptionKey: Redacted.Redacted<string>;
  readonly oauthRedirectUrl: string;
  readonly signingSecret: Redacted.Redacted<string>;
}

/** Server configuration capability for Slack setup; secrets remain in its implementation only. */
export class SlackIntegrationConfig extends Context.Service<
  SlackIntegrationConfig,
  SlackIntegrationConfigContract
>()("@feeblo/SlackIntegrationConfig") {}
