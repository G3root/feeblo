import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { parseGitHubAppInstallationCallbackUrl } from "./oauth-callback";

describe("parseGitHubAppInstallationCallbackUrl", () => {
  it("parses a complete GitHub App installation callback", async () => {
    const callback = await Effect.runPromise(
      parseGitHubAppInstallationCallbackUrl(
        "/github/app/callback?code=installer-code&state=opaque-state&installation_id=123456&setup_action=install"
      )
    );

    expect(callback).toEqual({
      code: "installer-code",
      state: "opaque-state",
      installationId: "123456",
      setupAction: "install",
    });
  });

  it("rejects a callback without the installation identity", async () => {
    const exit = await Effect.runPromiseExit(
      parseGitHubAppInstallationCallbackUrl(
        "/github/app/callback?code=installer-code&state=opaque-state&setup_action=install"
      )
    );

    expect(exit._tag).toBe("Failure");
  });
});
