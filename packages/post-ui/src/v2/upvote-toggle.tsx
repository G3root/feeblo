import type { TUpvote } from "@feeblo/domain/upvote/schema";
import { UpvoteId } from "@feeblo/id";
import { Button } from "@feeblo/ui/button";
import { Skeleton } from "@feeblo/ui/skeleton";
import { cn } from "@feeblo/ui/utils";
import { getUpvoteCollectionKey } from "@feeblo/web-shared/reaction-keys";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import NumberFlow from "@number-flow/react";
import type { Collection } from "@tanstack/react-db";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createContext, type ReactNode, use, useMemo } from "react";

import { usePostCollectionData } from "./post-page-context";
import { usePostCollections } from "./providers/post-collections-provider";

type UpvoteCollection = Collection<TUpvote, string, any, any>;

// ---------------------------------------------------------------------------
// Shared hook — all upvote query + toggle logic lives here.
// ---------------------------------------------------------------------------

interface UseUpvoteParams {
  organizationId: string;
  postId: string;
  upvoteCollection: UpvoteCollection;
  disabled: boolean;
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

  const { data: upvotes, isLoading: isUpvotesLoading } = useLiveQuery(
    (q) =>
      q
        .from({ upvote: upvoteCollection })
        .where(({ upvote }) =>
          and(
            eq(upvote.organizationId, organizationId),
            eq(upvote.postId, postId)
          )
        )
        .select(({ upvote }) => ({ id: upvote.id })),
    [organizationId, postId]
  );

  const { data: hasUserUpvoted, isLoading: isUserUpvotedLoading } =
    useLiveQuery(
      (q) => {
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
      [organizationId, postId, session?.user.id]
    );

  const isLoading = isUpvotesLoading || isUserUpvotedLoading;
  const upvoteCount = upvotes?.length ?? 0;
  const isUpvoted = !!hasUserUpvoted;

  const onToggle = async () => {
    if (disabled) return;
    if (!session) {
      onAuthRequired?.();
      return;
    }

    const userId = session.user.id;
    const key = getUpvoteCollectionKey({ userId, postId });
    const hasUpvoted = upvoteCollection.has(key);
    const membership = session.memberships.find(
      (m) => m.organizationId === organizationId && m.userId === session.user.id
    );

    if (hasUpvoted) {
      const tx = upvoteCollection.delete(key);
      await tx.isPersisted.promise;
    } else {
      const upvoteId = await UpvoteId.unsafeGenerate();
      const tx = upvoteCollection.insert({
        id: upvoteId,
        createdAt: new Date(),
        updatedAt: new Date(),
        organizationId,
        postId,
        userId,
        memberId: membership?.membershipId ?? null,
        user: {
          name: session.user.name ?? null,
          image: session.user.image ?? null,
        },
      });
      await tx.isPersisted.promise;
    }
  };

  return { isLoading, isUpvoted, onToggle, upvoteCount };
}

// ---------------------------------------------------------------------------
// Trigger — the single rendering primitive for every upvote button.
// ---------------------------------------------------------------------------

type TriggerVariant = "compact" | "default";

interface UpvoteTriggerProps {
  variant?: TriggerVariant;
  disabled?: boolean;
  isUpvoted: boolean;
  label?: string;
  onToggle: () => void | Promise<void>;
  upvoteCount: number;
}

function UpvoteTrigger({
  variant = "default",
  disabled = false,
  isUpvoted,
  label = "Upvote",
  onToggle,
  upvoteCount,
}: UpvoteTriggerProps) {
  if (variant === "compact") {
    return (
      <button
        aria-label={label}
        aria-pressed={isUpvoted}
        className={cn(
          "flex h-9 w-10 shrink-0 flex-col items-center justify-center rounded-md text-xs transition-colors",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
          isUpvoted
            ? "bg-primary/10 text-primary"
            : "bg-muted/70 text-muted-foreground hover:bg-muted"
        )}
        disabled={disabled}
        onClick={onToggle}
        type="button"
      >
        <span className="flex items-center gap-1.5">
          <HugeiconsIcon className="size-3" icon={ArrowUp01Icon} />
          <NumberFlow
            className="text-xs leading-none font-medium tabular-nums"
            style={{ fontVariantNumeric: "tabular-nums" }}
            value={upvoteCount}
            willChange
          />
        </span>
      </button>
    );
  }

  return (
    <Button
      aria-label={label}
      aria-pressed={isUpvoted}
      className="gap-1.5 rounded-full"
      disabled={disabled}
      onClick={onToggle}
      size="sm"
      type="button"
      variant={isUpvoted ? "default" : "outline"}
    >
      <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
      <NumberFlow
        style={{ fontVariantNumeric: "tabular-nums" }}
        value={upvoteCount}
        willChange
      />
    </Button>
  );
}

function UpvoteSkeleton({ variant = "default" }: { variant?: TriggerVariant }) {
  return (
    <div className="flex h-9 items-center">
      <Skeleton
        className={
          variant === "compact"
            ? "h-9 w-10 rounded-md"
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
  const { isLocked, post, organizationId } = usePostCollectionData();
  const {
    collections: { upvoteCollection },
    onAuthRequired,
  } = usePostCollections();

  const { isLoading, isUpvoted, onToggle, upvoteCount } = useUpvote({
    disabled: isLocked,
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
      disabled={isLocked}
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
  onToggle: () => void | Promise<void>;
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
  onToggle: () => void | Promise<void>;
  upvoteCount: number;
};

type UpvoteToggleRootProps = UpvoteToggleProviderProps & {
  variant?: TriggerVariant;
};

function UpvoteToggleProvider({
  children,
  disabled = false,
  isUpvoted,
  label = "Upvote",
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
