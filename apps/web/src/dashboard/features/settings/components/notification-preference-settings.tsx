import {
  SwitchCard,
  SwitchCardContent,
  SwitchCardDescription,
  SwitchCardInput,
  SwitchCardTitle,
} from "@feeblo/ui/switch-card";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@feeblo/ui/tabs";
import { toastManager } from "@feeblo/ui/toast";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useOrganizationId } from "~/hooks/use-organization-id";
import { fetchRpc } from "~/lib/runtime";

type PreferenceCategory =
  | "new_feedback"
  | "post_status_changed"
  | "changelog_published";

type PreferenceTarget = "all" | PreferenceCategory;

const preferenceQueryKey = (organizationId: string) => [
  "notification-preference",
  organizationId,
];

const categoryCopy = {
  new_feedback: {
    title: "New feedback",
    description:
      "Email when someone submits a new post in this workspace, whichever board it lands on.",
  },
  post_status_changed: {
    title: "Post status changes",
    description:
      "Email when a post moves status, is closed, or is merged or unmerged.",
  },
  changelog_published: {
    title: "Changelog published",
    description: "Email when a changelog entry goes live.",
  },
} satisfies Record<PreferenceCategory, { description: string; title: string }>;

const feedbackCategories: readonly PreferenceCategory[] = [
  "new_feedback",
  "post_status_changed",
];

const changelogCategories: readonly PreferenceCategory[] = [
  "changelog_published",
];

/**
 * The member's own email preferences for one workspace.
 *
 * Every member manages their own toggles; there is no administrator override
 * and no organization-wide switch. The master pause is stored in the same
 * sparse table as the category rows, so the categories underneath keep their
 * state while it is on.
 */
export function NotificationPreferenceSettings() {
  const organizationId = useOrganizationId();
  const { data: session } = useAuthState();
  const queryClient = useQueryClient();
  const [pendingTarget, setPendingTarget] = useState<PreferenceTarget | null>(
    null
  );
  const preferenceQuery = useQuery({
    queryKey: preferenceQueryKey(organizationId),
    queryFn: () =>
      fetchRpc((rpc) => rpc.NotificationPreferenceGet({ organizationId })),
    retry: false,
  });

  const state = preferenceQuery.data;

  const setPreference = async (target: PreferenceTarget, enabled: boolean) => {
    setPendingTarget(target);
    try {
      // The write answers with the state it committed, so the switches render
      // the server's resolution instead of a second read of it.
      const next = await fetchRpc((rpc) =>
        rpc.NotificationPreferenceSet({ enabled, organizationId, target })
      );
      queryClient.setQueryData(preferenceQueryKey(organizationId), next);
    } catch {
      toastManager.add({
        title: "Failed to update notification preferences",
        type: "error",
      });
    } finally {
      setPendingTarget(null);
    }
  };

  if (preferenceQuery.isError) {
    return (
      <p className="text-muted-foreground text-sm">
        Notification preferences could not be loaded. Reload the page to try
        again.
      </p>
    );
  }

  if (state === undefined) {
    return null;
  }

  const categorySwitch = (category: PreferenceCategory) => {
    const copy = categoryCopy[category];
    return (
      <SwitchCard key={category}>
        <SwitchCardContent>
          <SwitchCardTitle>{copy.title}</SwitchCardTitle>
          <SwitchCardDescription>{copy.description}</SwitchCardDescription>
        </SwitchCardContent>
        <SwitchCardInput
          aria-label={copy.title}
          checked={state.categories[category]}
          disabled={
            state.pausedAll ||
            preferenceQuery.isPending ||
            pendingTarget !== null
          }
          onCheckedChange={(next) => void setPreference(category, next)}
        />
      </SwitchCard>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {session?.user.emailVerified === false ? (
        <p className="text-muted-foreground text-sm">
          Your account email is not verified yet, so no notification emails can
          be delivered. Verify it from your profile settings to start receiving
          them.
        </p>
      ) : null}

      <SwitchCard variant="outline">
        <SwitchCardContent>
          <SwitchCardTitle>Pause all notification emails</SwitchCardTitle>
          <SwitchCardDescription>
            Stop every notification email for this workspace. Your per-category
            choices below are kept for when you turn it back on.
          </SwitchCardDescription>
        </SwitchCardContent>
        <SwitchCardInput
          aria-label="Pause all notification emails"
          checked={state.pausedAll}
          disabled={preferenceQuery.isPending || pendingTarget !== null}
          onCheckedChange={(next) => void setPreference("all", !next)}
        />
      </SwitchCard>

      <Tabs defaultValue="feedback">
        <TabsList>
          <TabsTab value="feedback">Feedback</TabsTab>
          <TabsTab value="changelog">Changelog</TabsTab>
        </TabsList>
        <TabsPanel className="flex flex-col gap-3" value="feedback">
          {feedbackCategories.map(categorySwitch)}
        </TabsPanel>
        <TabsPanel className="flex flex-col gap-3" value="changelog">
          {changelogCategories.map(categorySwitch)}
        </TabsPanel>
      </Tabs>
    </div>
  );
}
