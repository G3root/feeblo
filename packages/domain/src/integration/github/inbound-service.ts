import type { ParsedGitHubInboundRequest } from "@feeblo/domain-contracts/github-inbound";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { GitHubIntegrationError } from "./errors";

/** Parsed GitHub issue webhook fact accepted after signature verification by the adapter. */
export interface GitHubIssueWebhook {
  readonly deliveryId: string;
  readonly eventName: "issues";
  /** GitHub App installation identity decoded from the verified webhook payload. */
  readonly installationId: string;
  readonly issueNumber: number;
  readonly issueState: "open" | "closed";
  readonly repositoryName: string;
  readonly repositoryOwner: string;
}

/** GitHub App installation lifecycle fact decoded after signature verification. */
export interface GitHubInstallationLifecycleWebhook {
  readonly action: "deleted" | "suspend" | "unsuspend";
  readonly deliveryId: string;
  readonly installationId: string;
}

/** Applies GitHub webhook state once using the durable inbox record before evaluating linked-issue rules. */
export interface GitHubInboundServiceContract {
  /**
   * Routes one verified webhook delivery to its handler. Deliveries Feeblo
   * recognizes but intentionally ignores (untracked actions, repository
   * selection updates) resolve without mutating state.
   */
  readonly applyWebhook: (
    webhook: ParsedGitHubInboundRequest
  ) => Effect.Effect<void, GitHubIntegrationError>;
  /** Applies GitHub App suspension, restoration, or removal to the linked Feeblo connection. */
  readonly applyInstallationLifecycleWebhook: (
    webhook: GitHubInstallationLifecycleWebhook
  ) => Effect.Effect<void, GitHubIntegrationError>;
  readonly applyIssueWebhook: (
    webhook: GitHubIssueWebhook
  ) => Effect.Effect<void, GitHubIntegrationError>;
}

/** Application inbound service implemented against the webhook inbox and post-status workflow. */
export class GitHubInboundService extends Context.Service<
  GitHubInboundService,
  GitHubInboundServiceContract
>()("@feeblo/GitHubInboundService") {}
