import { PostSubscriptionId } from "@feeblo/id";
import { Button } from "@feeblo/ui/button";
import { anchoredToastManager, toastManager } from "@feeblo/ui/toast";
import { getPostSubscriptionCollectionKey } from "@feeblo/web-shared/reaction-keys";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { BellIcon, BellOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useRef } from "react";

import { usePostCollectionData } from "./post-page-context";
import { usePostCollections } from "./providers/post-collections-provider";

const ANCHORED_SUBSCRIBE_TOAST_ID = "post-subscribe";

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
export function SubscribeButton() {
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
  // Anchor for the success toast, so it pops up next to the button.
  const buttonRef = useRef<HTMLButtonElement>(null);
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

    // Capture the anchor synchronously: awaiting persistence can re-render or
    // replace the button, which would null `buttonRef.current` before the
    // toast is added.
    const anchor = buttonRef.current;

    // A rejected persistence is caught below so the error does not escape
    // unhandled; the optimistic flip is rolled back by the collection.
    isPersistingRef.current = true;
    try {
      const userId = session.user.id;
      const key = getPostSubscriptionCollectionKey({ userId, postId });

      if (postSubscriptionCollection.has(key)) {
        const transaction = postSubscriptionCollection.delete(key);
        await transaction.isPersisted.promise;
      } else {
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
      }

      if (anchor) {
        anchoredToastManager.add({
          id: ANCHORED_SUBSCRIBE_TOAST_ID,
          positionerProps: {
            anchor,
            sideOffset: 8,
          },
          timeout: 2000,
          title: isSubscribed
            ? "Unsubscribed from the post!"
            : "Subscribed to the post!",
        });
      }
    } catch {
      toastManager.add({
        title: "Failed to update subscription",
        type: "error",
      });
    } finally {
      isPersistingRef.current = false;
    }
  };

  const label = isSubscribed ? "Unsubscribe" : "Subscribe";

  return (
    <Button
      aria-label={label}
      aria-pressed={isSubscribed}
      disabled={disabled}
      onClick={onToggle}
      ref={buttonRef}
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

export function SubscribeCard() {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold">Subscribe to post</h2>
        <p className="text-muted-foreground text-xs text-pretty">
          Subscribe to receive future updates on the post by email
        </p>
      </div>

      <SubscribeButton />
    </>
  );
}
