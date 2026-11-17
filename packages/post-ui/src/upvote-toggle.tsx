import type { TUpvote } from "@feeblo/domain/upvote/schema";
import { UpvoteId } from "@feeblo/id";
import { Skeleton } from "@feeblo/ui/skeleton";
import { cn } from "@feeblo/ui/utils";
import { isLiveQueryPending } from "@feeblo/web-shared/collections";
import { getUpvoteCollectionKey } from "@feeblo/web-shared/reaction-keys";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import NumberFlow from "@number-flow/react";
import type { Collection } from "@tanstack/react-db";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createContext, type ReactNode, use, useMemo } from "react";

import { m } from "./paraglide/messages.js";
import { usePostCollectionData } from "./post-page-context";
import { usePostCollections } from "./providers/post-collections-provider";
import { useVoteBurst } from "./upvote-burst-machine";

type UpvoteCollection = Collection<TUpvote, string, any, any>;

// ---------------------------------------------------------------------------
// Shared hook — all upvote query + toggle logic lives here.
// ---------------------------------------------------------------------------

interface UseUpvoteParams {
  organizationId: string;
  postId: string;
  upvoteCollection: UpvoteCollection;
  disabled?: boolean;
  onAuthRequired: (() => void) | undefined;
}

function useUpvote({
  organizationId,
  postId,
  upvoteCollection,
  disabled = false,
  onAuthRequired,
}: UseUpvoteParams) {
  const { data: session } = useAuthState();

  // Explicit queryKeys: this hook runs once per card and re-renders on every
  // optimistic vote, so both queries take the hot-path escape hatch instead of
  // rebuilding and hashing their IR each render.
  const upvotesQuery = useLiveQuery({
    queryKey: ["post-upvotes", upvoteCollection.id, organizationId, postId],
    query: (q) =>
      q
        .from({ upvote: upvoteCollection })
        .where(({ upvote }) =>
          and(
            eq(upvote.organizationId, organizationId),
            eq(upvote.postId, postId)
          )
        )
        .select(({ upvote }) => ({ id: upvote.id })),
  });

  const upvotes = upvotesQuery.data;

  const userUpvoteQuery = useLiveQuery({
    queryKey: [
      "post-user-upvote",
      upvoteCollection.id,
      organizationId,
      postId,
      session?.user.id ?? null,
    ],
    query: (q) => {
      if (!session) return undefined;

      return q
        .from({ upvote: upvoteCollection })
        .where(({ upvote }) =>
          and(
            eq(upvote.organizationId, organizationId),
            eq(upvote.postId, postId),
            eq(upvote.userId, session.user.id)
          )
        )
        .select(({ upvote }) => ({ id: upvote.id }))
        .findOne();
    },
  });

  // A query with a result is content, not a loading state (see
  // `isLiveQueryPending`): the count renders from the hydrated rows while the
  // signed-in visitor's own vote resolves.
  const isLoading =
    isLiveQueryPending(upvotesQuery) || isLiveQueryPending(userUpvoteQuery);

  const upvoteCount = upvotes?.length ?? 0;
  const isUpvoted = !!userUpvoteQuery.data;

  const onToggle = async (): Promise<UpvoteOutcome> => {
    if (disabled) {
      return "noop";
    }

    if (!session) {
      onAuthRequired?.();

      return "noop";
    }

    const userId = session.user.id;
    const key = getUpvoteCollectionKey({ userId, postId });
    const intendedUpvoted = !upvoteCollection.has(key);

    const membership = session.memberships.find(
      (m) => m.organizationId === organizationId && m.userId === session.user.id
    );

    // A previous attempt may have committed on the server and then failed its
    // read-back, leaving this collection stale. Refresh before deciding, and
    // treat a row that already matches the intended state as success so a
    // retry cannot toggle it back.
    await upvoteCollection.utils.refetch({ throwOnError: true });

    if (upvoteCollection.has(key) === intendedUpvoted) {
      return "noop";
    }

    if (intendedUpvoted) {
      const upvoteId = await UpvoteId.unsafeGenerate();

      const tx = upvoteCollection.insert({
        id: upvoteId,
        createdAt: new Date(),
        updatedAt: new Date(),
        organizationId,
        postId,
        userId,
        memberId: membership?.membershipId ?? null,
        // Optimistic votes are cast on this post, never merged in.
        mergedFromPostId: null,
        user: {
          name: session.user.name ?? null,
          image: session.user.image ?? null,
        },
      });

      await tx.when("settled");

      return "cast";
    }

    const tx = upvoteCollection.delete(key);

    await tx.when("settled");

    return "cleared";
  };

  return { isLoading, isUpvoted, onToggle, upvoteCount };
}

// ---------------------------------------------------------------------------
// Trigger — the single rendering primitive for every upvote button.
// ---------------------------------------------------------------------------

type TriggerVariant = "compact" | "default";

/**
 * What a press did to the vote.
 *
 * The trigger needs this to know whether to confirm the press with the ring:
 * only a vote that was actually cast is worth confirming. `noop` covers the
 * presses that change nothing — a locked or merged post, a guest sent to the
 * sign-in dialog, or a retry that finds the row already in the intended state.
 */
export type UpvoteOutcome = "cast" | "cleared" | "noop";

/**
 * Shared trigger geometry and behaviour.
 *
 * These are plain `<button>`s rather than `<Button>`, because the two states
 * need four properties to move together (border, background, text colour, and
 * the arrow's offset) and layering Tailwind overrides on a `Button` variant
 * loses that race: `outline` already sets `bg-popover` and `dark:bg-input/32`,
 * and which of two background utilities wins is decided by Tailwind's internal
 * sort order, not by the order they appear in the class list.
 *
 * `active:scale-[0.96]` is the whole point of the press state: the count is
 * about to change, and the interface should confirm it heard the press before
 * the network answers. `pointer-coarse:after:*` reproduces the 44px touch
 * target the design system's buttons get, since this chip is 40px wide.
 */
const triggerBase = cn(
  "group/upvote relative inline-flex shrink-0 cursor-pointer items-center justify-center",
  "border font-medium outline-none select-none",
  "transition-[background-color,border-color,color,scale] duration-150 ease-out",
  "focus-visible:ring-brand/40 focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-1",
  "active:scale-[0.96]",
  "disabled:pointer-events-none disabled:opacity-64",
  "motion-reduce:transition-none motion-reduce:active:scale-100",
  "pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11"
);

/**
 * Both grounds use the brand tint for "you voted": the product's one accent
 * already means "this is the affirmative action", and a vote is the most
 * affirmative thing on a board.
 */
const variantStyles = {
  compact: {
    idle: "border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
    // No gap between arrow and count: the chevron's own box already carries
    // about a third of its height as padding, so a gap on top of that reads as
    // two separate objects rather than one stacked symbol.
    frame: "h-11 min-w-10 flex-col rounded-lg px-1 text-[11px] leading-none",
    voted:
      "border-brand/40 bg-brand/12 text-brand hover:bg-brand/16 hover:text-brand",
  },
  default: {
    idle: "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground",
    frame: "h-9 gap-1.5 rounded-full px-3.5 text-[13px] leading-none",
    voted:
      "border-brand/40 bg-brand/12 text-brand hover:bg-brand/16 hover:text-brand",
  },
} satisfies Record<
  TriggerVariant,
  { frame: string; idle: string; voted: string }
>;

/**
 * A rising count spins its digits up and a falling one spins them down. The
 * trend is read from the values themselves rather than assumed from
 * `isUpvoted`, so a vote that arrives from someone else through the live query
 * animates in the right direction too.
 */
const trendFromValues = (oldValue: number, value: number) =>
  Math.sign(value - oldValue);

/**
 * Hoisted so the timing object keeps one identity across renders: NumberFlow
 * applies these as properties, and a fresh object each render would rewrite
 * them mid-spin.
 *
 * NumberFlow's own default spin is 500ms, which is long for a number that
 * changed because of a click the visitor just made. 340ms still reads as a
 * roll rather than a swap.
 */
const spinTiming: EffectTiming = {
  duration: 340,
  easing: "cubic-bezier(0.23, 1, 0.32, 1)",
};

interface UpvoteTriggerProps {
  variant?: TriggerVariant;
  disabled?: boolean;
  isUpvoted: boolean;
  label?: string;
  /**
   * Runs the toggle and reports what it did. Returning `"cast"` is what earns
   * the ring; returning nothing is allowed for a caller that does not track
   * the outcome, and then the press simply is not confirmed.
   */
  onToggle: () => UpvoteOutcome | void | Promise<UpvoteOutcome | void>;
  upvoteCount: number;
}

function UpvoteArrow({
  bursting,
  isUpvoted,
}: {
  bursting: boolean;
  isUpvoted: boolean;
}) {
  return (
    <span className="relative flex items-center justify-center">
      {bursting ? (
        <span
          aria-hidden
          // `motion-reduce:hidden`, not `motion-reduce:animate-none`: the
          // animation's last frame is `opacity: 0`, so removing the animation
          // without removing the element leaves a solid ring on screen.
          className="animate-vote-burst border-brand/60 pointer-events-none absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border motion-reduce:hidden"
          data-slot="upvote-burst"
        />
      ) : null}
      <HugeiconsIcon
        className={cn(
          "transition-transform duration-200 ease-out",
          "size-4",
          // One pixel of lift, kept short: the arrow leaves the baseline the
          // way a pressed key does, and the state is still readable from the
          // colour alone for anyone who prefers not to see movement.
          isUpvoted && "-translate-y-px motion-reduce:translate-y-0"
        )}
        icon={ArrowUp01Icon}
        strokeWidth={2.5}
      />
    </span>
  );
}

function UpvoteTrigger({
  variant = "default",
  disabled = false,
  isUpvoted,
  label = m.mild_tidy_hare(),
  onToggle,
  upvoteCount,
}: UpvoteTriggerProps) {
  const { bursting, cast } = useVoteBurst();
  const styles = variantStyles[variant];

  const handlePress = async () => {
    const outcome = await onToggle();

    if (outcome === "cast") {
      cast();
    }
  };

  return (
    <button
      aria-label={label}
      aria-pressed={isUpvoted}
      className={cn(
        triggerBase,
        styles.frame,
        isUpvoted ? styles.voted : styles.idle
      )}
      data-slot="upvote-trigger"
      data-state={isUpvoted ? "voted" : "idle"}
      disabled={disabled}
      onClick={handlePress}
      type="button"
    >
      <UpvoteArrow bursting={bursting} isUpvoted={isUpvoted} />
      <NumberFlow
        className="tabular-nums"
        respectMotionPreference
        spinTiming={spinTiming}
        style={{ fontVariantNumeric: "tabular-nums" }}
        trend={trendFromValues}
        value={upvoteCount}
        willChange
      />
    </button>
  );
}

function UpvoteSkeleton({ variant = "default" }: { variant?: TriggerVariant }) {
  return (
    <div
      className={cn(
        "flex items-center",
        variant === "compact" ? "h-11" : "h-9"
      )}
    >
      <Skeleton
        className={
          variant === "compact"
            ? "h-11 w-10 rounded-lg"
            : "h-9 w-20 rounded-full"
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// UpvoteButton — reads organizationId / postId / collection from PostPage context.
// ---------------------------------------------------------------------------

export interface UpvoteButtonProps {
  variant?: TriggerVariant;
}

export function UpvoteButton({ variant }: UpvoteButtonProps) {
  const { isLocked, isMerged, post, organizationId } = usePostCollectionData();

  const {
    collections: { upvoteCollection },
    onAuthRequired,
  } = usePostCollections();

  // A merged post stays disabled until it is unmerged: its votes live on the
  // survivor, so voting here would split the record.
  const disabled = isLocked || isMerged;

  const { isLoading, isUpvoted, onToggle, upvoteCount } = useUpvote({
    disabled,
    onAuthRequired: onAuthRequired ?? undefined,
    organizationId,
    postId: post.id,
    upvoteCollection,
  });

  if (isLoading) {
    return <UpvoteSkeleton variant={variant} />;
  }

  return (
    <UpvoteTrigger
      disabled={disabled}
      isUpvoted={isUpvoted}
      onToggle={onToggle}
      upvoteCount={upvoteCount}
      variant={variant}
    />
  );
}

// ---------------------------------------------------------------------------
// StandaloneUpvoteButton — accepts props directly, no PostPage context needed.
// ---------------------------------------------------------------------------

export interface StandaloneUpvoteButtonProps {
  variant?: TriggerVariant;
  organizationId: string;
  postId: string;
  upvoteCollection: UpvoteCollection;
  disabled?: boolean;
  onAuthRequired?: () => void;
}

export function StandaloneUpvoteButton({
  variant,
  organizationId,
  postId,
  upvoteCollection,
  disabled = false,
  onAuthRequired,
}: StandaloneUpvoteButtonProps) {
  const { isLoading, isUpvoted, onToggle, upvoteCount } = useUpvote({
    disabled,
    onAuthRequired: onAuthRequired ?? undefined,
    organizationId,
    postId,
    upvoteCollection,
  });

  if (isLoading) {
    return <UpvoteSkeleton variant={variant} />;
  }

  return (
    <UpvoteTrigger
      disabled={disabled}
      isUpvoted={isUpvoted}
      onToggle={onToggle}
      upvoteCount={upvoteCount}
      variant={variant}
    />
  );
}

// ---------------------------------------------------------------------------
// UpvoteToggle — composable variant (Provider + Trigger).
// ---------------------------------------------------------------------------

type UpvoteToggleState = {
  disabled: boolean;
  isUpvoted: boolean;
  upvoteCount: number;
};

type UpvoteToggleActions = {
  onToggle: () => UpvoteOutcome | void | Promise<UpvoteOutcome | void>;
};

type UpvoteToggleMeta = {
  label: string;
};

type UpvoteToggleContextValue = {
  actions: UpvoteToggleActions;
  meta: UpvoteToggleMeta;
  state: UpvoteToggleState;
};

const UpvoteToggleContext = createContext<UpvoteToggleContextValue | null>(
  null
);

function useUpvoteToggleContext() {
  const value = use(UpvoteToggleContext);

  if (!value) {
    throw new Error("UpvoteToggle components must be used within Provider.");
  }

  return value;
}

type UpvoteToggleProviderProps = {
  children?: ReactNode;
  disabled?: boolean;
  isUpvoted: boolean;
  label?: string;
  onToggle: () => UpvoteOutcome | void | Promise<UpvoteOutcome | void>;
  upvoteCount: number;
};

type UpvoteToggleRootProps = UpvoteToggleProviderProps & {
  variant?: TriggerVariant;
};

function UpvoteToggleProvider({
  children,
  disabled = false,
  isUpvoted,
  label = m.mild_tidy_hare(),
  onToggle,
  upvoteCount,
}: UpvoteToggleProviderProps) {
  const contextValue = useMemo<UpvoteToggleContextValue>(
    () => ({
      actions: { onToggle },
      meta: { label },
      state: { disabled, isUpvoted, upvoteCount },
    }),
    [disabled, isUpvoted, label, onToggle, upvoteCount]
  );

  return (
    <UpvoteToggleContext value={contextValue}>{children}</UpvoteToggleContext>
  );
}

function UpvoteToggleTrigger({
  variant = "default",
}: {
  variant?: TriggerVariant;
}) {
  const { actions, meta, state } = useUpvoteToggleContext();

  return (
    <UpvoteTrigger
      disabled={state.disabled}
      isUpvoted={state.isUpvoted}
      label={meta.label}
      onToggle={actions.onToggle}
      upvoteCount={state.upvoteCount}
      variant={variant}
    />
  );
}

function UpvoteToggleComponent({
  variant = "default",
  ...providerProps
}: UpvoteToggleRootProps) {
  return (
    <UpvoteToggleProvider {...providerProps}>
      <UpvoteToggleTrigger variant={variant} />
    </UpvoteToggleProvider>
  );
}

export const UpvoteToggle = Object.assign(UpvoteToggleComponent, {
  Provider: UpvoteToggleProvider,
  Trigger: UpvoteToggleTrigger,
});
