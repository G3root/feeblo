import type { TChangelogSubscription } from "@feeblo/domain/changelog-subscription/schema";
import { ChangelogSubscriptionId } from "@feeblo/id";
import { useAuthDialogContext } from "@feeblo/post-ui/dialog-stores";
import { Button } from "@feeblo/ui/button";
import { anchoredToastManager, toastManager } from "@feeblo/ui/toast";
import { getChangelogSubscriptionCollectionKey } from "@feeblo/web-shared/reaction-keys";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { BellIcon, BellOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useRef } from "react";

import { publicChangelogSubscriptionCollection } from "../../lib/collections";
import { useSite } from "../../providers/site-provider";

const ANCHORED_SUBSCRIBE_TOAST_ID = "changelog-subscribe";

/**
 * Toggles the current user's subscription to the workspace changelog.
 * Subscribers receive in-app notifications when a new entry is published.
 * The toggle is optimistic: inserting/deleting the subscription row in the
 * local collection immediately flips the button state, while the collection's
 * `onInsert`/`onDelete` handlers persist the change through the public RPCs.
 */
export function ChangelogSubscribeButton() {
  const site = useSite();
  const authDialogStore = useAuthDialogContext();
  const { data: session, isPending: isAuthPending } = useAuthState();
  const organizationId = site.organizationId;

  // Re-entrancy guard: blocks a second toggle while the previous mutation is
  // still persisting. A ref avoids re-rendering the button on every toggle.
  const isPersistingRef = useRef(false);
  // Anchor for the success toast, so it pops up next to the button.
  const buttonRef = useRef<HTMLButtonElement>(null);

  const { data: hasUserSubscribed, isLoading: isSubscriptionLoading } =
    useLiveQuery(
      (q) => {
        if (!(organizationId && session)) {
          return undefined;
        }
        return q
          .from({ subscription: publicChangelogSubscriptionCollection })
          .where(({ subscription }) =>
            and(
              eq(subscription.organizationId, organizationId),
              eq(subscription.userId, session.user.id)
            )
          )
          .select(({ subscription }) => ({ id: subscription.id }))
          .findOne();
      },
      [organizationId, session?.user.id]
    );

  // Wait for the authoritative auth/subscription state before rendering, so a
  // signed-in subscriber never sees a stale "Subscribe" flash.
  if (isAuthPending || (session && isSubscriptionLoading)) {
    return null;
  }

  const isSubscribed = Boolean(hasUserSubscribed);

  const onToggle = async () => {
    if (isPersistingRef.current) {
      return;
    }

    if (!session) {
      authDialogStore.send({
        type: "setOpen",
        open: true,
        data: { variant: "sign-in" },
      });
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
      const key = getChangelogSubscriptionCollectionKey({
        userId,
        organizationId,
      });

      if (publicChangelogSubscriptionCollection.has(key)) {
        const transaction = publicChangelogSubscriptionCollection.delete(key);
        await transaction.isPersisted.promise;
      } else {
        const id = await ChangelogSubscriptionId.unsafeGenerate();
        const row: TChangelogSubscription = {
          id,
          createdAt: new Date(),
          updatedAt: new Date(),
          organizationId,
          userId,
          memberId:
            session.memberships.find(
              (value) => value.organizationId === organizationId
            )?.membershipId ?? null,
        };
        const transaction = publicChangelogSubscriptionCollection.insert(row);
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
            ? "Unsubscribed from the changelog!"
            : "Subscribed to the changelog!",
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
