import * as Effect from "effect/Effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  loadChannels,
  loadConnections,
  loadSlackStatus,
} from "./lib/connections";

export type SlackConnection = Awaited<
  ReturnType<typeof loadConnections>
>[number];
export type SlackChannel = Awaited<ReturnType<typeof loadChannels>>[number];

/**
 * Client-side source of truth for the Slack settings page.
 *
 * Connection and channel lists are Effect atoms whose results stream into
 * React through `useAtomValue` from `@effect/atom-react`. Mutations refresh
 * the matching atom after they succeed so the visible state stays in sync.
 */
export const slackAtomRegistry = AtomRegistry.make();

/** Slack connections of one organization, one cached atom per organization id. */
export const connectionsAtom = Atom.family((organizationId: string) =>
  Atom.make(Effect.tryPromise(() => loadConnections(organizationId))).pipe(
    Atom.swr({
      staleTime: "30 seconds",
      revalidateOnFocus: "always",
      focusSignal: Atom.windowFocusSignal,
    }),
    Atom.setIdleTTL("5 minutes")
  )
);

export type ChannelListArgs = {
  readonly organizationId: string;
  readonly connectionId: string;
};

/** Channels of one connection, one cached atom per connection id. */
export const channelsAtom = Atom.family((args: ChannelListArgs) =>
  Atom.make(
    Effect.tryPromise(() =>
      loadChannels(args.organizationId, args.connectionId)
    )
  ).pipe(
    Atom.swr({
      staleTime: "30 seconds",
      revalidateOnFocus: "always",
      focusSignal: Atom.windowFocusSignal,
    }),
    Atom.setIdleTTL("5 minutes")
  )
);

/** Whether the Slack integration is configured for this deployment (global, not per-org). */
export const slackStatusAtom = Atom.make(
  Effect.tryPromise(() => loadSlackStatus())
).pipe(
  Atom.swr({
    staleTime: "30 seconds",
    revalidateOnFocus: "always",
    focusSignal: Atom.windowFocusSignal,
  }),
  Atom.setIdleTTL("5 minutes")
);
