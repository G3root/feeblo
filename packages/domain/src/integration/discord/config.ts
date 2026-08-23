import * as Context from "effect/Context";
import type * as Redacted from "effect/Redacted";

/**
 * Runtime Discord integration configuration: the application credentials,
 * the application-wide bot token, the interaction public key, the OAuth
 * redirect URL, and the at-rest encryption key. The server composition root
 * supplies the values; secrets remain outside connection and route JSON
 * (see docs/adr/0002).
 *
 * The bot token and public key are application-wide (one bot serves every
 * guild install), so they live in configuration — exactly like the Slack
 * signing secret — instead of in per-connection encrypted credentials.
 */
export interface DiscordIntegrationConfigContract {
  /** Dashboard base URL used for post-installation redirects. */
  readonly appUrl: string;
  readonly authorizeScopes: readonly string[];
  readonly botToken: Redacted.Redacted<string>;
  /** Discord App client identifier; never persisted in integration JSON. */
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted<string>;
  /**
   * True only when the OAuth client id, client secret, bot token, and
   * interaction public key are all configured; otherwise the deployment runs
   * without Discord.
   */
  readonly configured: boolean;
  readonly encryptionKey: Redacted.Redacted<string>;
  readonly oauthRedirectUrl: string;
  /** OAuth permissions bitmask requested for the bot install. */
  readonly permissions: number;
  readonly publicKey: string;
}

/** Server configuration capability for Discord setup; secrets remain in its implementation only. */
export class DiscordIntegrationConfig extends Context.Service<
  DiscordIntegrationConfig,
  DiscordIntegrationConfigContract
>()("@feeblo/DiscordIntegrationConfig") {}
