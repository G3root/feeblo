import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type {
  IntegrationCapabilityHandler,
  IntegrationInboundCapabilityHandler,
  IntegrationProviderKey,
  IntegrationProviderRegistration,
} from "./integration-contracts";

/** Startup failure when a statically registered provider does not meet its manifest contract. */
export class IntegrationProviderRegistryValidationError extends Schema.TaggedError<IntegrationProviderRegistryValidationError>()(
  "IntegrationProviderRegistryValidationError",
  {
    capabilityKey: Schema.optionalKey(Schema.String),
    message: Schema.String,
    provider: Schema.String,
  }
) {}

/** Startup-validated lookup of statically composed provider registrations. */
export interface IntegrationProviderRegistry {
  readonly getHandler: (input: {
    readonly capabilityKey: string;
    readonly provider: IntegrationProviderKey;
  }) => IntegrationCapabilityHandler | undefined;
  readonly getInboundHandler: (input: {
    readonly capabilityKey: string;
    readonly provider: IntegrationProviderKey;
  }) => IntegrationInboundCapabilityHandler | undefined;
  readonly getRegistration: (
    provider: IntegrationProviderKey
  ) => IntegrationProviderRegistration | undefined;
  readonly manifests: readonly IntegrationProviderRegistration["manifest"][];
}

const registryValidationFailure = ({
  capabilityKey,
  message,
  provider,
}: {
  readonly capabilityKey?: string;
  readonly message: string;
  readonly provider: string;
}) =>
  new IntegrationProviderRegistryValidationError({
    ...(capabilityKey === undefined ? {} : { capabilityKey }),
    message,
    provider,
  });

/** Validates static provider registrations once at startup before workers can send. */
export const makeIntegrationProviderRegistry = (
  registrations: readonly IntegrationProviderRegistration[]
): Effect.Effect<
  IntegrationProviderRegistry,
  IntegrationProviderRegistryValidationError
> =>
  Effect.gen(function* () {
    const registrationsByProvider = new Map<
      string,
      IntegrationProviderRegistration
    >();

    for (const registration of registrations) {
      const provider = registration.manifest.provider;
      if (registrationsByProvider.has(provider)) {
        return yield* registryValidationFailure({
          message:
            "Integration provider registry duplicate provider registration",
          provider,
        });
      }

      const handlersByCapability = new Map<
        string,
        IntegrationCapabilityHandler
      >();
      for (const handler of registration.handlers) {
        if (handlersByCapability.has(handler.capabilityKey)) {
          return yield* registryValidationFailure({
            capabilityKey: handler.capabilityKey,
            message:
              "Integration provider registry duplicate capability handler",
            provider,
          });
        }
        handlersByCapability.set(handler.capabilityKey, handler);
      }

      const inboundHandlersByCapability = new Map<
        string,
        IntegrationInboundCapabilityHandler
      >();
      for (const handler of registration.inboundHandlers ?? []) {
        if (inboundHandlersByCapability.has(handler.capabilityKey)) {
          return yield* registryValidationFailure({
            capabilityKey: handler.capabilityKey,
            message:
              "Integration provider registry duplicate inbound capability handler",
            provider,
          });
        }
        inboundHandlersByCapability.set(handler.capabilityKey, handler);
      }

      for (const capability of registration.manifest.capabilities) {
        if (!registration.routeConfigurationSchemas.has(capability.key)) {
          return yield* registryValidationFailure({
            capabilityKey: capability.key,
            message:
              "Integration provider registry missing route configuration schema",
            provider,
          });
        }
        if (capability.direction === "outbound") {
          if (!handlersByCapability.has(capability.key)) {
            return yield* registryValidationFailure({
              capabilityKey: capability.key,
              message:
                "Integration provider registry missing capability handler",
              provider,
            });
          }
        } else if (capability.direction === "inbound") {
          if (!inboundHandlersByCapability.has(capability.key)) {
            return yield* registryValidationFailure({
              capabilityKey: capability.key,
              message:
                "Integration provider registry missing inbound capability handler",
              provider,
            });
          }
        } else {
          return yield* registryValidationFailure({
            capabilityKey: capability.key,
            message:
              "Integration provider registry unsupported capability direction in V1",
            provider,
          });
        }
      }

      const advertisedCapabilities = new Set(
        registration.manifest.capabilities.map((capability) => capability.key)
      );
      for (const handler of registration.handlers) {
        if (!advertisedCapabilities.has(handler.capabilityKey)) {
          return yield* registryValidationFailure({
            capabilityKey: handler.capabilityKey,
            message:
              "Integration provider registry handler for unadvertised capability",
            provider,
          });
        }
      }
      for (const handler of registration.inboundHandlers ?? []) {
        if (!advertisedCapabilities.has(handler.capabilityKey)) {
          return yield* registryValidationFailure({
            capabilityKey: handler.capabilityKey,
            message:
              "Integration provider registry inbound handler for unadvertised capability",
            provider,
          });
        }
      }

      registrationsByProvider.set(provider, registration);
    }

    return {
      getHandler: ({ capabilityKey, provider }) =>
        registrationsByProvider
          .get(provider)
          ?.handlers.find((handler) => handler.capabilityKey === capabilityKey),
      getInboundHandler: ({ capabilityKey, provider }) =>
        registrationsByProvider
          .get(provider)
          ?.inboundHandlers.find(
            (handler) => handler.capabilityKey === capabilityKey
          ),
      getRegistration: (provider) => registrationsByProvider.get(provider),
      manifests: registrations.map((registration) => registration.manifest),
    };
  });
