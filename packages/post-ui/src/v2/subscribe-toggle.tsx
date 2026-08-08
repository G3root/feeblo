import { PostSubscriptionId } from "@feeblo/id";
import { Button } from "@feeblo/ui/button";
import { toastManager } from "@feeblo/ui/toast";
import { cn } from "@feeblo/ui/utils";
import { getPostSubscriptionCollectionKey } from "@feeblo/web-shared/reaction-keys";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { BellIcon, BellOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useRef } from "react";
import { usePostCollectionData } from "./post-page-context";
import { usePostCollections } from "./providers/post-collections-provider";

interface SubscribeButtonProps {
  variant?: "compact" | "default";
}

/**
 * Toggles the current user's subscription to a post. Subscribers receive
 * in-app notifications when the post gets a comment or its status changes.
 * Works for dashboard members and signed-in public board visitors alike; the
 * public RPC counterpart is used automatically because the collection's
 * mutation hooks call the `*Public` endpoints when mounted on a public board.
 *
 * The toggle is optimistic: inserting/deleting the subscription row in the
 * local collection immediately flips the button state, while the collection's
 * `onInsert`/`onDelete` handlers persist the change to the backend.
 */
export function SubscribeButton({ variant = "default" }: SubscribeButtonProps) {
  const { isLocked, organizationId, post } = usePostCollectionData();
  const { data: session } = useAuthState();
  const {
    collections: { postSubscriptionCollection },
    onAuthRequired,
  } = usePostCollections();

  const postId = post.id;
  // Re-entrancy guard: blocks a second toggle while the previous mutation is
  // still persisting. A ref avoids re-rendering the button on every toggle.
  const isPersistingRef = useRef(false);
  const disabled = isLocked;

  const { data: hasUserSubscribed, isLoading: isSubscriptionLoading } =
    useLiveQuery(
      (q) => {
        if (!(postId && session)) {
          return undefined;
        }
        return q
          .from({ subscription: postSubscriptionCollection })
          .where(({ subscription }) =>
            and(
              eq(subscription.organizationId, organizationId),
              eq(subscription.postId, postId),
              eq(subscription.userId, session.user.id)
            )
          )
          .select(({ subscription }) => ({ id: subscription.id }))
          .findOne();
      },
      [organizationId, postId, session?.user.id]
    );

  if (isSubscriptionLoading) {
    return null;
  }

  const isSubscribed = Boolean(hasUserSubscribed);

  const onToggle = async () => {
    if (disabled) {
      return;
    }

    if (isPersistingRef.current) {
      return;
    }

    if (!session) {
      onAuthRequired?.();
      return;
    }

    // A rejected persistence is caught below so the error does not escape
    // unhandled; the optimistic flip is rolled back by the collection.
    isPersistingRef.current = true;
    try {
      const userId = session.user.id;
      const key = getPostSubscriptionCollectionKey({ userId, postId });

      if (postSubscriptionCollection.has(key)) {
        const transaction = postSubscriptionCollection.delete(key);
        await transaction.isPersisted.promise;
        return;
      }

      const membership = session.memberships.find(
        (value) =>
          value.organizationId === organizationId &&
          value.userId === session.user.id
      );

      const id = await PostSubscriptionId.unsafeGenerate();
      const transaction = postSubscriptionCollection.insert({
        id,
        createdAt: new Date(),
        updatedAt: new Date(),
        organizationId,
        postId,
        userId,
        memberId: membership?.membershipId ?? null,
      });
      await transaction.isPersisted.promise;
    } catch (_error) {
      toastManager.add({
        title: "Failed to update subscription",
        type: "error",
      });
    } finally {
      isPersistingRef.current = false;
    }
  };

  const label = isSubscribed ? "Unsubscribe" : "Subscribe";

  if (variant === "compact") {
    return (
      <button
        aria-label={label}
        aria-pressed={isSubscribed}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
          isSubscribed
            ? "bg-primary/10 text-primary hover:bg-primary/15"
            : "bg-muted/70 hover:bg-muted"
        )}
        disabled={disabled}
        onClick={onToggle}
        type="button"
      >
        <HugeiconsIcon
          className="size-4"
          icon={isSubscribed ? BellOffIcon : BellIcon}
          strokeWidth={2}
        />
      </button>
    );
  }

  return (
    <Button
      aria-label={label}
      aria-pressed={isSubscribed}
      className="gap-1.5 rounded-full"
      disabled={disabled}
      onClick={onToggle}
      size="sm"
      type="button"
      variant={isSubscribed ? "default" : "outline"}
    >
      <HugeiconsIcon
        icon={isSubscribed ? BellOffIcon : BellIcon}
        strokeWidth={2}
      />
      {label}
    </Button>
  );
}
