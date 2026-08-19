import type { GitHubSyncRule as GitHubSyncRuleSchema } from "@feeblo/domain/integration/github/schema";
import * as Result from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";

import { DashboardClient, dashboardSWR } from "~/lib/atom-rpc";

export const gitHubReactivityKeys = (organizationId: string) => ({
  github: [organizationId],
});

/** GitHub App installations cached per organization. */
export const gitHubConnectionsAtom = Atom.family((organizationId: string) =>
  DashboardClient.query(
    "GitHubConnectionList",
    { organizationId },
    { reactivityKeys: gitHubReactivityKeys(organizationId) }
  ).pipe(dashboardSWR("30 seconds"), Atom.setIdleTTL("5 minutes"))
);

export type GitHubConnection = Atom.Success<
  ReturnType<typeof gitHubConnectionsAtom>
>[number];

/** Whether the GitHub App is configured for this deployment. */
export const gitHubIntegrationStatusAtom = DashboardClient.query(
  "GitHubIntegrationStatus",
  void 0
).pipe(
  dashboardSWR("30 seconds"),
  Atom.map((result) => Result.map(result, (value) => value.configured)),
  Atom.setIdleTTL("5 minutes")
);

export type GitHubConnectionArgs = {
  readonly organizationId: string;
  readonly connectionId: string;
};

/** Repositories available to one GitHub connection. */
export const gitHubRepositoriesAtom = Atom.family(
  (args: GitHubConnectionArgs) =>
    DashboardClient.query("GitHubRepositoryList", args, {
      reactivityKeys: gitHubReactivityKeys(args.organizationId),
    }).pipe(dashboardSWR("30 seconds"), Atom.setIdleTTL("5 minutes"))
);

export type GitHubRepository = Atom.Success<
  ReturnType<typeof gitHubRepositoriesAtom>
>[number];

/** Automatic publishing settings for one GitHub connection. */
export const gitHubPublishSettingsAtom = Atom.family(
  (args: GitHubConnectionArgs) =>
    DashboardClient.query("GitHubSettingsGet", args, {
      reactivityKeys: gitHubReactivityKeys(args.organizationId),
    }).pipe(dashboardSWR("30 seconds"), Atom.setIdleTTL("5 minutes"))
);

export type GitHubPublishSettings = Atom.Success<
  ReturnType<typeof gitHubPublishSettingsAtom>
>;

/** State synchronization rules for one GitHub connection. */
export const gitHubSyncRulesAtom = Atom.family((args: GitHubConnectionArgs) =>
  DashboardClient.query("GitHubRuleList", args, {
    reactivityKeys: gitHubReactivityKeys(args.organizationId),
  }).pipe(dashboardSWR("30 seconds"), Atom.setIdleTTL("5 minutes"))
);

export type GitHubSyncRule = GitHubSyncRuleSchema;

/** Boards available for scoping automatic publishing. */
export const gitHubBoardsAtom = Atom.family((organizationId: string) =>
  DashboardClient.query(
    "BoardList",
    { organizationId },
    {
      reactivityKeys: {
        ...gitHubReactivityKeys(organizationId),
        boards: [organizationId],
      },
    }
  ).pipe(dashboardSWR("30 seconds"), Atom.setIdleTTL("5 minutes"))
);

export type GitHubBoard = Atom.Success<
  ReturnType<typeof gitHubBoardsAtom>
>[number];

/** Feeblo statuses available as synchronization-rule targets. */
export const gitHubPostStatusesAtom = Atom.family((organizationId: string) =>
  DashboardClient.query(
    "PostStatusList",
    { organizationId },
    {
      reactivityKeys: {
        ...gitHubReactivityKeys(organizationId),
        postStatuses: [organizationId],
      },
    }
  ).pipe(dashboardSWR("30 seconds"), Atom.setIdleTTL("5 minutes"))
);

export type GitHubPostStatus = Atom.Success<
  ReturnType<typeof gitHubPostStatusesAtom>
>[number];

export const startGitHubConnectAtom =
  DashboardClient.mutation("GitHubConnectStart");
export const disconnectGitHubConnectionAtom = DashboardClient.mutation(
  "GitHubConnectionDisconnect"
);
export const updateGitHubPublishSettingsAtom = DashboardClient.mutation(
  "GitHubSettingsUpdate"
);
export const createGitHubSyncRuleAtom =
  DashboardClient.mutation("GitHubRuleCreate");
export const updateGitHubSyncRuleAtom =
  DashboardClient.mutation("GitHubRuleUpdate");
export const deleteGitHubSyncRuleAtom =
  DashboardClient.mutation("GitHubRuleDelete");
export const createGitHubPostIssueAtom = DashboardClient.mutation(
  "GitHubPostIssueCreate"
);
export const linkGitHubPostIssueAtom = DashboardClient.mutation(
  "GitHubPostIssueLink"
);
