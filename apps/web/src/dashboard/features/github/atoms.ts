import type { GitHubSyncRule as GitHubSyncRuleSchema } from "@feeblo/domain/integration/github/schema";
import * as Effect from "effect/Effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  loadGitHubBoards,
  loadGitHubConnections,
  loadGitHubIntegrationStatus,
  loadGitHubPostStatuses,
  loadGitHubPublishSettings,
  loadGitHubRepositories,
  loadGitHubSyncRules,
} from "./lib/github-connections";

export type GitHubConnection = Awaited<
  ReturnType<typeof loadGitHubConnections>
>[number];
export type GitHubRepository = Awaited<
  ReturnType<typeof loadGitHubRepositories>
>[number];
export type GitHubPublishSettings = Awaited<
  ReturnType<typeof loadGitHubPublishSettings>
>;
/** GitHub state synchronization rule derived from the shared Effect Schema. */
export type GitHubSyncRule = GitHubSyncRuleSchema;
export type GitHubBoard = Awaited<ReturnType<typeof loadGitHubBoards>>[number];
export type GitHubPostStatus = Awaited<
  ReturnType<typeof loadGitHubPostStatuses>
>[number];

/** Isolated Effect atom registry for GitHub integration screens. */
export const gitHubAtomRegistry = AtomRegistry.make();

/** GitHub App installations cached per organization. */
export const gitHubConnectionsAtom = Atom.family((organizationId: string) =>
  Atom.make(
    Effect.tryPromise(() => loadGitHubConnections(organizationId))
  ).pipe(
    Atom.swr({
      staleTime: "30 seconds",
      revalidateOnFocus: "always",
      focusSignal: Atom.windowFocusSignal,
    }),
    Atom.setIdleTTL("5 minutes")
  )
);

/** GitHub setup availability for this deployment. */
export const gitHubIntegrationStatusAtom = Atom.make(
  Effect.tryPromise(() => loadGitHubIntegrationStatus())
).pipe(
  Atom.swr({
    staleTime: "30 seconds",
    revalidateOnFocus: "always",
    focusSignal: Atom.windowFocusSignal,
  }),
  Atom.setIdleTTL("5 minutes")
);

export type GitHubConnectionArgs = {
  readonly organizationId: string;
  readonly connectionId: string;
};

/** Repositories available to one GitHub connection. */
export const gitHubRepositoriesAtom = Atom.family(
  (args: GitHubConnectionArgs) =>
    Atom.make(Effect.tryPromise(() => loadGitHubRepositories(args))).pipe(
      Atom.swr({
        staleTime: "30 seconds",
        revalidateOnFocus: "always",
        focusSignal: Atom.windowFocusSignal,
      }),
      Atom.setIdleTTL("5 minutes")
    )
);

/** Automatic publishing settings for one GitHub connection. */
export const gitHubPublishSettingsAtom = Atom.family(
  (args: GitHubConnectionArgs) =>
    Atom.make(Effect.tryPromise(() => loadGitHubPublishSettings(args))).pipe(
      Atom.swr({
        staleTime: "30 seconds",
        revalidateOnFocus: "always",
        focusSignal: Atom.windowFocusSignal,
      }),
      Atom.setIdleTTL("5 minutes")
    )
);

/** State synchronization rules for one GitHub connection. */
export const gitHubSyncRulesAtom = Atom.family((args: GitHubConnectionArgs) =>
  Atom.make(Effect.tryPromise(() => loadGitHubSyncRules(args))).pipe(
    Atom.swr({
      staleTime: "30 seconds",
      revalidateOnFocus: "always",
      focusSignal: Atom.windowFocusSignal,
    }),
    Atom.setIdleTTL("5 minutes")
  )
);

/** Boards available for scoping automatic GitHub issue publishing. */
export const gitHubBoardsAtom = Atom.family((organizationId: string) =>
  Atom.make(Effect.tryPromise(() => loadGitHubBoards(organizationId))).pipe(
    Atom.swr({
      staleTime: "30 seconds",
      revalidateOnFocus: "always",
      focusSignal: Atom.windowFocusSignal,
    }),
    Atom.setIdleTTL("5 minutes")
  )
);

/** Feeblo statuses available as synchronization-rule targets. */
export const gitHubPostStatusesAtom = Atom.family((organizationId: string) =>
  Atom.make(
    Effect.tryPromise(() => loadGitHubPostStatuses(organizationId))
  ).pipe(
    Atom.swr({
      staleTime: "30 seconds",
      revalidateOnFocus: "always",
      focusSignal: Atom.windowFocusSignal,
    }),
    Atom.setIdleTTL("5 minutes")
  )
);
