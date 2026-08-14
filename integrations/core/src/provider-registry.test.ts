import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  IntegrationCapabilityKey,
  IntegrationProviderKey,
  type IntegrationProviderRegistration,
  makeIntegrationProviderRegistry,
} from "./index";

const testProviderKey = IntegrationProviderKey.make("test-provider");

const webhookRegistration = ({
  handlers = [
    {
      capabilityKey: IntegrationCapabilityKey.make("events.post"),
      deliver: () => Effect.succeed({}),
    },
  ],
  inboundHandlers = [],
  manifest,
  routeConfigurationSchemas = new Map([["events.post", Schema.Json]]),
}: Partial<IntegrationProviderRegistration> = {}): IntegrationProviderRegistration => ({
  connectionConfigurationSchema: Schema.Json,
  handlers,
  inboundHandlers,
  manifest: manifest ?? {
    capabilities: [
      { configVersion: 1, direction: "outbound", key: IntegrationCapabilityKey.make("events.post") },
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

  it("rejects a handler for a capability not advertised in the manifest", () => {
    const registration = webhookRegistration();
    const exit = Effect.runSyncExit(
      makeIntegrationProviderRegistry([
        {
          ...registration,
          handlers: [
            {
              capabilityKey: IntegrationCapabilityKey.make("events.post"),
              deliver: () => Effect.succeed({}),
            },
          ],
          manifest: {
            ...registration.manifest,
            capabilities: [],
          },
        },
      ])
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("provides an inbound capability handler after startup validation", () => {
    const registration = webhookRegistration({
      inboundHandlers: [
        {
          capabilityKey: IntegrationCapabilityKey.make("commands"),
          handle: () => Effect.succeed({ body: {}, status: 200 }),
        },
      ],
      manifest: {
        capabilities: [
          { configVersion: 1, direction: "outbound", key: IntegrationCapabilityKey.make("events.post") },
          { configVersion: 1, direction: "inbound", key: IntegrationCapabilityKey.make("commands") },
        ],
        connectionMode: "none",
        displayName: "Webhook",
        provider: testProviderKey,
      },
      routeConfigurationSchemas: new Map([
        ["events.post", Schema.Json],
        ["commands", Schema.Json],
      ]),
    });
    const registry = Effect.runSync(
      makeIntegrationProviderRegistry([registration])
    );

    expect(
      registry.getInboundHandler({
        capabilityKey: "commands",
        provider: testProviderKey,
      })
    ).toBeDefined();
  });

  it("rejects an advertised inbound capability without an inbound handler", () => {
    const registration = webhookRegistration();
    const exit = Effect.runSyncExit(
      makeIntegrationProviderRegistry([
        {
          ...registration,
          manifest: {
            ...registration.manifest,
            capabilities: [
              { configVersion: 1, direction: "inbound", key: IntegrationCapabilityKey.make("commands") },
            ],
          },
          routeConfigurationSchemas: new Map([["commands", Schema.Json]]),
        },
      ])
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
