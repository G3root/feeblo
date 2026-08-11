import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import {
  isWebhookPrivateOrReservedAddress,
  resolveAndValidateWebhookEndpoint,
  validateWebhookEndpointUrl,
} from "./webhook-endpoint-security";

const production = {
  environment: "production",
  allowPrivateNetworkInDevelopment: false,
} as const;

describe("webhook endpoint security", () => {
  it.each([
    "http://example.com/hook",
    "https://user:password@example.com/hook",
    "https://example.com/hook#fragment",
    "https://localhost/hook",
    "https://127.0.0.1/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/hook",
    "https://[fd00::1]/hook",
    "https://[::ffff:169.254.169.254]/hook",
  ])("rejects unsafe endpoint %s", async (url) => {
    await expect(
      Effect.runPromise(validateWebhookEndpointUrl(url, production))
    ).rejects.toMatchObject({ _tag: "WebhookEndpointSecurityError" });
  });

  it("permits a local receiver only through the explicit development override", async () => {
    await expect(
      Effect.runPromise(
        validateWebhookEndpointUrl("http://127.0.0.1:8080/hook", {
          environment: "development",
          allowPrivateNetworkInDevelopment: true,
        })
      )
    ).resolves.toMatchObject({ hostname: "127.0.0.1" });
  });

  it("recognizes cloud metadata, documentation, private, and multicast addresses", () => {
    for (const address of [
      "169.254.169.254",
      "10.0.0.1",
      "192.0.2.1",
      "203.0.113.1",
      "224.0.0.1",
      "::1",
      "fe80::1",
      "2001:db8::1",
    ]) {
      expect(isWebhookPrivateOrReservedAddress(address)).toBe(true);
    }
    expect(isWebhookPrivateOrReservedAddress("8.8.8.8")).toBe(false);
  });

  it("rejects a mixed public/private DNS answer before it can be pinned", async () => {
    const resolver = () =>
      Effect.succeed(["8.8.8.8", "169.254.169.254"] as const);
    await expect(
      Effect.runPromise(
        resolveAndValidateWebhookEndpoint(
          "https://example.com/hook",
          production,
          resolver
        )
      )
    ).rejects.toMatchObject({ _tag: "WebhookEndpointSecurityError" });
  });
});
