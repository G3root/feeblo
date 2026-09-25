import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

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
      {
        configVersion: 1,
        direction: "outbound",
        key: IntegrationCapabilityKey.make("events.post"),
      },
    ],
    connectionMode: "none",
    displayName: "Webhook",
    provider: testProviderKey,
  },
  routeConfigurationSchemas,
});

describe("makeIntegrationProviderRegistry", () => {
  it.effect(
    "provides an advertised capability handler after startup validation",
    () =>
      Effect.gen(function* () {
        const registry = yield* makeIntegrationProviderRegistry([
          webhookRegistration(),
        ]);

        expect(
          registry.getHandler({
            capabilityKey: "events.post",
            provider: testProviderKey,
          })
        ).toBeDefined();
        expect(registry.manifests).toHaveLength(1);
      })
  );

  it.effect(
    "rejects an advertised capability without a configuration schema",
    () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          makeIntegrationProviderRegistry([
            webhookRegistration({ routeConfigurationSchemas: new Map() }),
          ])
        );

        expect(Exit.isFailure(exit)).toBe(true);
      })
  );

  it.effect("rejects duplicate static provider registrations", () =>
    Effect.gen(function* () {
      const registration = webhookRegistration();
      const exit = yield* Effect.exit(
        makeIntegrationProviderRegistry([registration, registration])
      );

      expect(Exit.isFailure(exit)).toBe(true);
    })
  );

  it.effect(
    "rejects a handler for a capability not advertised in the manifest",
    () =>
      Effect.gen(function* () {
        const registration = webhookRegistration();
        const exit = yield* Effect.exit(
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
      })
  );

  it.effect(
    "provides an inbound capability handler after startup validation",
    () =>
      Effect.gen(function* () {
        const registration = webhookRegistration({
          inboundHandlers: [
            {
              capabilityKey: IntegrationCapabilityKey.make("commands"),
              handle: () => Effect.succeed({ body: {}, status: 200 }),
            },
          ],
          manifest: {
            capabilities: [
              {
                configVersion: 1,
                direction: "outbound",
                key: IntegrationCapabilityKey.make("events.post"),
              },
              {
                configVersion: 1,
                direction: "inbound",
                key: IntegrationCapabilityKey.make("commands"),
              },
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
        const registry = yield* makeIntegrationProviderRegistry([registration]);

        expect(
          registry.getInboundHandler({
            capabilityKey: "commands",
            provider: testProviderKey,
          })
        ).toBeDefined();
      })
  );

  it.effect(
    "rejects an advertised inbound capability without an inbound handler",
    () =>
      Effect.gen(function* () {
        const registration = webhookRegistration();
        const exit = yield* Effect.exit(
          makeIntegrationProviderRegistry([
            {
              ...registration,
              manifest: {
                ...registration.manifest,
                capabilities: [
                  {
                    configVersion: 1,
                    direction: "inbound",
                    key: IntegrationCapabilityKey.make("commands"),
                  },
                ],
              },
              routeConfigurationSchemas: new Map([["commands", Schema.Json]]),
            },
          ])
        );

        expect(Exit.isFailure(exit)).toBe(true);
      })
  );
});
