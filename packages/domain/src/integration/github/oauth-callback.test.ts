import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { parseGitHubAppInstallationCallbackUrl } from "./oauth-callback";

describe("parseGitHubAppInstallationCallbackUrl", () => {
  it.effect("parses a complete GitHub App installation callback", () =>
    Effect.gen(function* () {
      const callback = yield* parseGitHubAppInstallationCallbackUrl(
        "/github/app/callback?code=installer-code&state=opaque-state&installation_id=123456&setup_action=install"
      );

      expect(callback).toEqual({
        code: "installer-code",
        state: "opaque-state",
        installationId: "123456",
        setupAction: "install",
      });
    })
  );

  it.effect("rejects a callback without the installation identity", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        parseGitHubAppInstallationCallbackUrl(
          "/github/app/callback?code=installer-code&state=opaque-state&setup_action=install"
        )
      );

      expect(Exit.isFailure(exit)).toBe(true);
    })
  );
});
