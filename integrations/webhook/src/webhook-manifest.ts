/** Browser-safe custom-webhook capability metadata; this module imports no Node APIs. */
import {
  IntegrationCapabilityKey,
  IntegrationProviderKey,
  IntegrationProviderManifest,
  IntegrationRouteEventSelection,
} from "@feeblo/integration-core";
import * as Schema from "effect/Schema";

/** Provider key owned by the custom-webhook adapter, outside the provider-neutral kernel. */
export const webhookProviderKey = IntegrationProviderKey.make("webhook");

/** Browser-safe provider key for the only V1 integration provider. */
export const WebhookProviderKey = Schema.Literal("webhook");

/** Browser-safe event configuration persisted on a custom-webhook route. */
export const WebhookRouteConfiguration = Schema.Struct({
  version: Schema.Literal(1),
  eventTypes: IntegrationRouteEventSelection,
});

/** Browser-safe connection form data. The endpoint is encrypted before persistence. */
export const WebhookConnectionConfiguration = Schema.Struct({
  endpointUrl: Schema.String,
});

/** Browser-safe webhook provider manifest consumed by management UI and registry composition. */
export const webhookProviderManifest = IntegrationProviderManifest.make({
  provider: webhookProviderKey,
  displayName: "Custom webhook",
  connectionMode: "none",
  capabilities: [
    {
      key: IntegrationCapabilityKey.make("events.post"),
      direction: "outbound",
      configVersion: 1,
    },
  ],
});

export type WebhookConnectionConfiguration = Schema.Schema.Type<
  typeof WebhookConnectionConfiguration
>;
export type WebhookRouteConfiguration = Schema.Schema.Type<
  typeof WebhookRouteConfiguration
>;
