import { useAuthDialogContext } from "@feeblo/post-ui/dialog-stores";
import { Button } from "@feeblo/ui/button";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { BellIcon, BellOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import { useSite } from "../../providers/site-provider";

const changelogSubscriptionQueryKey = (organizationId: string) =>
  ["changelog-subscription", organizationId] as const;

/**
 * Toggles the visitor's email subscription to the workspace changelog.
 * Signed-out visitors are prompted to sign in first, mirroring the post
 * subscribe button. Subscribing is available on every plan; only subscriber
 * email delivery is plan-gated, and the server enforces that when emails
 * materialize.
 *
 * The toggle is optimistic: the button flips immediately and rolls back if
 * persistence fails.
 */
export function ChangelogSubscribeButton() {
  const site = useSite();
  const queryClient = useQueryClient();
  const authDialogStore = useAuthDialogContext();
  const { data: session, isPending: isAuthPending } = useAuthState();

  const organizationId = site.organizationId;
  const queryKey = changelogSubscriptionQueryKey(organizationId);

  // Re-entrancy guard: blocks a second toggle while the previous mutation is
  // still persisting. A ref avoids re-rendering the button on every toggle.
  const isPersistingRef = useRef(false);

  const { data: subscription, isLoading: isSubscriptionLoading } = useQuery({
    enabled: Boolean(session),
    queryFn: () =>
      fetchRpc((rpc) =>
        rpc.EmailSubscriptionChangelogStatusGet({ organizationId })
      ),
    queryKey,
    staleTime: 60_000,
  });

  const setSubscribed = useMutation({
    mutationFn: (subscribed: boolean) =>
      fetchRpc((rpc) =>
        rpc.EmailSubscriptionChangelogSubscribeSet({
          organizationId,
          subscribed,
        })
      ),
    onMutate: async (subscribed) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, { subscribed });
      return { previous };
    },
    onError: (error, _subscribed, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      console.error("Failed to update the changelog subscription", error);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  if (isAuthPending) {
    return null;
  }

  // Wait for the authoritative subscription state before rendering, so a
  // signed-in subscriber never sees a stale "Subscribe" flash.
  if (session && isSubscriptionLoading) {
    return null;
  }

  const isSubscribed = Boolean(subscription?.subscribed);

  const onToggle = () => {
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

    isPersistingRef.current = true;
    setSubscribed.mutate(!isSubscribed, {
      onSettled: () => {
        isPersistingRef.current = false;
      },
    });
  };

  const label = isSubscribed ? "Unsubscribe" : "Subscribe";

  return (
    <Button
      aria-label={label}
      aria-pressed={isSubscribed}
      disabled={setSubscribed.isPending}
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
