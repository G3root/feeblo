import type { WebhookEndpointSecurityPolicy } from "@feeblo/integration-webhook";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

/**
 * Runtime security policy for outbound webhooks: the at-rest encryption key
 * for endpoint credentials and the egress policy applied to every endpoint
 * URL before it is persisted or requested.
 */
export class WebhookIntegrationConfig extends Context.Service<WebhookIntegrationConfig>()(
  "WebhookIntegrationConfig",
  {
    make: Effect.gen(function* () {
      // INTEGRATION_ENCRYPTION_KEY defaults to AUTH_ENCRYPTION_KEY when unset,
      // so deployments can share a single required secret for both.
      const encryptionKey = yield* Config.redacted(
        "INTEGRATION_ENCRYPTION_KEY"
      ).pipe(
        Config.option,
        Effect.flatMap(
          Option.match({
            onNone: () => Config.redacted("AUTH_ENCRYPTION_KEY"),
            onSome: (key) => Effect.succeed(key),
          })
        )
      );
      const nodeEnv = yield* Config.string("NODE_ENV").pipe(
        Config.withDefault("development")
      );
      const allowPrivateNetwork = yield* Config.boolean(
        "INTEGRATION_ALLOW_PRIVATE_NETWORK"
      ).pipe(Config.withDefault(false));
      const environment = (() => {
        if (nodeEnv === "production") {
          return "production" as const;
        }
        if (nodeEnv === "test") {
          return "test" as const;
        }
        return "development" as const;
      })();
      return {
        encryptionKey,
        endpointSecurityPolicy: {
          // The private-network override is only honored in development; in
          // every other environment the policy rejects private egress.
          allowPrivateNetworkInDevelopment:
            nodeEnv === "development" && allowPrivateNetwork,
          environment,
        },
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);

  /** Supplies a fixed security policy and encryption key to tests. */
  static readonly layerTest = ({
    encryptionKey = Redacted.make("0123456789abcdef0123456789abcdef"),
    environment = "test",
    allowPrivateNetworkInDevelopment = false,
  }: {
    readonly allowPrivateNetworkInDevelopment?: boolean;
    readonly encryptionKey?: Redacted.Redacted<string>;
    readonly environment?: WebhookEndpointSecurityPolicy["environment"];
  } = {}) =>
    Layer.succeed(
      this,
      this.of({
        encryptionKey,
        endpointSecurityPolicy: {
          allowPrivateNetworkInDevelopment,
          environment,
        },
      })
    );
}
