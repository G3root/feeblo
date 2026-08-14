/** Browser-safe GitHub capability metadata; this module imports no Node APIs. */
import {
  IntegrationCapabilityKey,
  IntegrationProviderKey,
  IntegrationProviderManifest,
} from "@feeblo/integration-core/contracts";
import * as Schema from "effect/Schema";

export const githubProviderKey = IntegrationProviderKey.make("github");
export const githubIssueCreateCapabilityKey = IntegrationCapabilityKey.make(
  "github.issue.create"
);
export const githubIssueWebhookCapabilityKey = IntegrationCapabilityKey.make(
  "github.issue.webhook"
);

/** GitHub App permissions required by Feeblo's bot integration. */
export const GITHUB_APP_PERMISSIONS = {
  /** Feeblo creates issues, writes backlink comments, and observes issue state. */
  issues: "write",
  /** Metadata read access is granted automatically to GitHub Apps. */
  metadata: "read",
} as const;

export const GitHubConnectionConfiguration = Schema.Struct({});

/** A repository and optional Feeblo board selection for automatic issue creation. */
export const GitHubIssueCreateRouteConfiguration = Schema.Struct({
  version: Schema.Literal(1),
  repositoryOwner: Schema.NonEmptyString,
  repositoryName: Schema.NonEmptyString,
  boardId: Schema.optionalKey(Schema.NonEmptyString),
});
export type GitHubIssueCreateRouteConfiguration = Schema.Schema.Type<
  typeof GitHubIssueCreateRouteConfiguration
>;

/** Inbound webhooks are configured at the connection level, never per route. */
export const GitHubIssueWebhookRouteConfiguration = Schema.Struct({
  version: Schema.Literal(1),
});

export const githubProviderManifest = IntegrationProviderManifest.make({
  provider: githubProviderKey,
  displayName: "GitHub",
  connectionMode: "github_app",
  capabilities: [
    {
      key: githubIssueCreateCapabilityKey,
      direction: "outbound",
      configVersion: 1,
    },
    {
      key: githubIssueWebhookCapabilityKey,
      direction: "inbound",
      configVersion: 1,
    },
  ],
});
