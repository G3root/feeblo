import {
  SwitchCard,
  SwitchCardContent,
  SwitchCardDescription,
  SwitchCardInput,
  SwitchCardTitle,
} from "@feeblo/ui/switch-card";
import { toastManager } from "@feeblo/ui/toast";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useOrganizationId } from "~/hooks/use-organization-id";
import { fetchRpc } from "~/lib/runtime";

const preferenceQueryKey = (organizationId: string) => [
  "email-notification-preference",
  organizationId,
];

/**
 * The destination of the "unsubscribe" link in submission-notification email,
 * and the toggle that decides whether this account receives that email at all.
 *
 * The preference is per (workspace, account), so it is read and written for
 * the workspace in the URL rather than for the account globally.
 */
export function SubmissionNotificationSetting() {
  const organizationId = useOrganizationId();
  const { data: session } = useAuthState();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const preferenceQuery = useQuery({
    queryKey: preferenceQueryKey(organizationId),
    queryFn: () =>
      fetchRpc((rpc) =>
        rpc.EmailSubmissionNotificationPreferenceGet({ organizationId })
      ),
    retry: false,
  });

  const enabled = preferenceQuery.data?.enabled ?? false;

  const handleChange = async (next: boolean) => {
    setIsSaving(true);
    try {
      // The write answers with the state it committed, so the switch renders
      // the server's answer instead of a second read of it.
      const state = await fetchRpc((rpc) =>
        rpc.EmailSubmissionNotificationPreferenceSet({
          enabled: next,
          organizationId,
        })
      );
      queryClient.setQueryData(preferenceQueryKey(organizationId), state);
      trackEvent("email_notification_preference_changed", {
        enabled: state.enabled,
        success: true,
      });
      toastManager.add({
        title: state.enabled
          ? "Submission emails turned on"
          : "Submission emails turned off",
        type: "success",
      });
    } catch {
      trackEvent("email_notification_preference_changed", {
        enabled: next,
        success: false,
      });
      toastManager.add({
        title: "Failed to update email notifications",
        type: "error",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (preferenceQuery.isError) {
    return (
      <p className="text-muted-foreground text-sm">
        Email notification preferences could not be loaded. Reload the page to
        try again.
      </p>
    );
  }

  return (
    <SwitchCard>
      <SwitchCardContent>
        <SwitchCardTitle>New submission emails</SwitchCardTitle>
        <SwitchCardDescription>
          Email{" "}
          {session?.user.email ? (
            <span className="text-foreground font-medium">
              {session.user.email}
            </span>
          ) : (
            "you"
          )}{" "}
          a summary when someone submits feedback in this workspace. On plans
          that allow a single recipient, turning this on moves the emails from
          whoever currently receives them to you.
        </SwitchCardDescription>
      </SwitchCardContent>
      <SwitchCardInput
        checked={enabled}
        disabled={isSaving || preferenceQuery.isPending}
        onCheckedChange={(next) => void handleChange(next)}
      />
    </SwitchCard>
  );
}
