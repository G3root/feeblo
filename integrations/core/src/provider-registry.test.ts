import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  IntegrationProviderKey,
  type IntegrationProviderRegistration,
  makeIntegrationProviderRegistry,
} from "./index";

const testProviderKey = IntegrationProviderKey.make("test-provider");

const webhookRegistration = ({
  handlers = [
    {
      capabilityKey: "events.post",
      deliver: () => Effect.succeed({}),
    },
  ],
  routeConfigurationSchemas = new Map([["events.post", Schema.Json]]),
}: Partial<IntegrationProviderRegistration> = {}): IntegrationProviderRegistration => ({
  connectionConfigurationSchema: Schema.Json,
  handlers,
  manifest: {
    capabilities: [
      { configVersion: 1, direction: "outbound", key: "events.post" },
    ],
    connectionMode: "none",
    displayName: "Webhook",
    provider: testProviderKey,
  },
  routeConfigurationSchemas,
});

describe("makeIntegrationProviderRegistry", () => {
  it("provides an advertised capability handler after startup validation", () => {
    const registry = Effect.runSync(
      makeIntegrationProviderRegistry([webhookRegistration()])
    );

    expect(
      registry.getHandler({
        capabilityKey: "events.post",
        provider: testProviderKey,
      })
    ).toBeDefined();
    expect(registry.manifests).toHaveLength(1);
  });

  it("rejects an advertised capability without a configuration schema", () => {
    const exit = Effect.runSyncExit(
      makeIntegrationProviderRegistry([
        webhookRegistration({ routeConfigurationSchemas: new Map() }),
      ])
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("rejects duplicate static provider registrations", () => {
    const registration = webhookRegistration();
    const exit = Effect.runSyncExit(
      makeIntegrationProviderRegistry([registration, registration])
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
