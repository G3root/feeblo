import {
  GitHubAppInstallationCallback,
  type GitHubAppInstallationCallback as GitHubAppInstallationCallbackType,
} from "@feeblo/domain/integration/github/schema";
import { BadRequestError } from "@feeblo/domain/rpc-errors";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** Parses the GitHub App installation callback URL without exposing its temporary code in logs or responses. */
export const parseGitHubAppInstallationCallbackUrl = (
  url: string
): Effect.Effect<GitHubAppInstallationCallbackType, BadRequestError> => {
  const parsed = new URL(url, "http://localhost");
  return Schema.decodeUnknownEffect(GitHubAppInstallationCallback)({
    code: parsed.searchParams.get("code"),
    state: parsed.searchParams.get("state"),
    installationId: parsed.searchParams.get("installation_id"),
    setupAction: parsed.searchParams.get("setup_action"),
  }).pipe(
    Effect.mapError(
      () =>
        new BadRequestError({
          message: "GitHub App installation callback parameters are invalid.",
        })
    )
  );
};
