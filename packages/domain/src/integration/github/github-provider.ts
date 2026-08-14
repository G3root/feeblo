import type { LegidOf } from "@feeblo/id";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { GitHubIntegrationError } from "./errors";
import type {
  GitHubAppInstallationCallback,
  GitHubConnectStarted,
  GitHubPostIssueCreate,
  GitHubPostIssueLink,
  GitHubRepository,
  GitHubResolvedIssue,
} from "./schema";

/** Narrow GitHub I/O capability implemented by the provider adapter; persistence and policy stay in the domain service. */
export interface GitHubProviderShape {
  /** Verifies installer access to the App installation without persisting either temporary token. */
  readonly completeInstallation: (
    input: GitHubAppInstallationCallback
  ) => Effect.Effect<
    { readonly organizationId: string },
    GitHubIntegrationError
  >;
  /** Creates a GitHub issue using the stable idempotency key as its external request identity. */
  readonly createIssue: (
    input: GitHubPostIssueCreate & {
      readonly postTitle: string | null;
      readonly postUrl: URL;
    }
  ) => Effect.Effect<GitHubResolvedIssue, GitHubIntegrationError>;
  readonly listRepositories: (input: {
    readonly connectionId: string;
  }) => Effect.Effect<readonly GitHubRepository[], GitHubIntegrationError>;
  /** Resolves an existing issue and writes a Feeblo bot comment backlink before persistence. */
  readonly resolveIssue: (
    input: GitHubPostIssueLink & { readonly postUrl: URL }
  ) => Effect.Effect<GitHubResolvedIssue, GitHubIntegrationError>;
  /** Starts an installation of the Feeblo GitHub App for one organization. */
  readonly startInstallation: (
    organizationId: LegidOf<"WorkspaceId">
  ) => Effect.Effect<GitHubConnectStarted, GitHubIntegrationError>;
  /** Uninstalls the App from GitHub before Feeblo archives the connection. */
  readonly uninstallInstallation: (input: {
    readonly connectionId: string;
  }) => Effect.Effect<void, GitHubIntegrationError>;
}

/** Provider adapter key selected by server composition. */
export class GitHubProvider extends Context.Service<
  GitHubProvider,
  GitHubProviderShape
>()("@feeblo/GitHubProvider") {}
