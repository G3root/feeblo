import { UpvoteId } from "@feeblo/id";
import { Button } from "@feeblo/ui/button";
import { cn } from "@feeblo/ui/utils";
import { getUpvoteCollectionKey } from "@feeblo/web-shared/reaction-keys";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createContext, type ReactNode, use } from "react";
import { usePostCollections } from "./providers/post-collections-provider";

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

function useUpvoteToggle() {
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
  variant?: "compact" | "default";
};

function UpvoteToggleProvider({
  children,
  disabled = false,
  isUpvoted,
  label = "Upvote",
  onToggle,
  upvoteCount,
}: UpvoteToggleProviderProps) {
  return (
    <UpvoteToggleContext
      value={{
        actions: { onToggle },
        meta: { label },
        state: { disabled, isUpvoted, upvoteCount },
      }}
    >
      {children}
    </UpvoteToggleContext>
  );
}

type UpvoteToggleTriggerProps = {
  variant?: "compact" | "default";
};

function UpvoteToggleTrigger({
  variant = "default",
}: UpvoteToggleTriggerProps) {
  const { actions, meta, state } = useUpvoteToggle();

  const handleToggle = () => {
    if (state.disabled) {
      return;
    }
    actions.onToggle();
  };

  if (variant === "compact") {
    return (
      <button
        aria-label={meta.label}
        className={cn(
          "flex h-9 w-10 shrink-0 flex-col items-center justify-center rounded-md text-xs transition-colors",
          state.isUpvoted
            ? "bg-primary/10 text-primary"
            : "bg-muted/70 text-muted-foreground hover:bg-muted"
        )}
        disabled={state.disabled}
        onClick={handleToggle}
        type="button"
      >
        <HugeiconsIcon className="size-3" icon={ArrowUp01Icon} />
        <span className="font-medium text-xs tabular-nums leading-none">
          {state.upvoteCount}
        </span>
      </button>
    );
  }

  return (
    <Button
      aria-label={meta.label}
      className="rounded-full"
      disabled={state.disabled}
      onClick={handleToggle}
      size="sm"
      type="button"
      variant={state.isUpvoted ? "default" : "outline"}
    >
      <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
      <span>{state.upvoteCount}</span>
    </Button>
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

interface UpvoteButtonProps
  extends Omit<
    UpvoteToggleProviderProps,
    "onToggle" | "children" | "isUpvoted" | "upvoteCount"
  > {
  postId: string;
  variant?: "compact" | "default";
}

export function UpvoteButton({
  disabled,
  variant,
  postId,
  ...rest
}: UpvoteButtonProps) {
  const { data: session } = useAuthState();
  const {
    collections: { upvoteCollection },
    organizationId,
  } = usePostCollections();

  const { data: upvotes, isLoading: isUpvotesLoading } = useLiveQuery(
    (q) => {
      if (!postId) {
        return undefined;
      }
      return q
        .from({ upvote: upvoteCollection })
        .where(({ upvote }) =>
          and(
            eq(upvote.organizationId, organizationId),
            eq(upvote.postId, postId)
          )
        )
        .select(({ upvote }) => ({ id: upvote.id }));
    },
    [organizationId, postId]
  );

  const { data: hasUserUpvoted, isLoading: isUserUpvotedLoading } =
    useLiveQuery(
      (q) => {
        if (!(postId && session)) {
          return undefined;
        }
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
      [organizationId, postId]
    );

  if (isUpvotesLoading || isUserUpvotedLoading) {
    return null;
  }

  const onToggle = async () => {
    if (disabled || !session) {
      return;
    }
    const userId = session.user.id;
    const key = getUpvoteCollectionKey({ userId, postId });

    const hasUpvoted = upvoteCollection.has(key);

    const membership = session.memberships.find(
      (value) =>
        value.organizationId === organizationId &&
        value.userId === session.user.id
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
          name: session?.user?.name ?? null,
          image: session?.user?.image ?? null,
        },
      });
      await tx.isPersisted.promise;
    }
  };

  return (
    <UpvoteToggleProvider
      disabled={disabled}
      isUpvoted={!!hasUserUpvoted}
      onToggle={onToggle}
      upvoteCount={upvotes?.length ?? 0}
      {...rest}
    >
      <UpvoteToggleTrigger variant={variant} />
    </UpvoteToggleProvider>
  );
}

export const UpvoteToggle = Object.assign(UpvoteToggleComponent, {
  Provider: UpvoteToggleProvider,
  Trigger: UpvoteToggleTrigger,
});
