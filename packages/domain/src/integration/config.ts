import type { WebhookEndpointSecurityPolicy } from "@feeblo/domain-contracts/integration";
import * as Context from "effect/Context";
import type * as Redacted from "effect/Redacted";

/**
 * Runtime security policy for outbound webhooks: the at-rest encryption key
 * for endpoint credentials and the egress policy applied to every endpoint
 * URL before it is persisted or requested. The server composition root
 * supplies the values; secrets remain outside connection and route JSON
 * (see docs/adr/0002).
 */
export interface WebhookIntegrationConfigContract {
  readonly encryptionKey: Redacted.Redacted<string>;
  readonly endpointSecurityPolicy: WebhookEndpointSecurityPolicy;
}

/** Server configuration capability for webhook security; secrets remain in its implementation only. */
export class WebhookIntegrationConfig extends Context.Service<
  WebhookIntegrationConfig,
  WebhookIntegrationConfigContract
>()("@feeblo/WebhookIntegrationConfig") {}
