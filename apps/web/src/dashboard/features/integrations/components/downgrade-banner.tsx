import { Alert, AlertDescription, AlertTitle } from "@feeblo/ui/alert";
import { Button } from "@feeblo/ui/button";
import { CalendarClockIcon, PauseCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRouter } from "@tanstack/react-router";

import { useDowngradeState } from "~/hooks/use-downgrade-state";
import { useOrganizationId } from "~/hooks/use-organization-id";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});

/**
 * Non-blocking notice shown on every settings page while the workspace is
 * downgraded with held integrations, or while a paid plan is scheduled to end.
 * Never blocks navigation or unrelated settings work.
 */
export function DowngradeBanner() {
  const router = useRouter();
  const organizationId = useOrganizationId();
  const downgradeState = useDowngradeState();

  if (downgradeState === null) {
    return null;
  }

  if (downgradeState.scheduledDowngrade !== null) {
    return (
      <Alert variant="info">
        <HugeiconsIcon icon={CalendarClockIcon} />
        <AlertTitle>Plan change scheduled</AlertTitle>
        <AlertDescription>
          This workspace moves to the Free plan on{" "}
          {dateFormatter.format(
            downgradeState.scheduledDowngrade.currentPeriodEnd
          )}
          . The Free plan doesn&rsquo;t include Slack, Discord, and GitHub
          integrations — deliveries for connections you keep will pause then.
        </AlertDescription>
        <Button
          className="mt-3"
          onClick={() =>
            router.navigate({
              to: "/$organizationId/settings/integrations",
              params: { organizationId },
            })
          }
          size="sm"
          type="button"
          variant="outline"
        >
          Review integrations
        </Button>
      </Alert>
    );
  }

  if (downgradeState.isDowngraded) {
    return (
      <Alert variant="warning">
        <HugeiconsIcon icon={PauseCircleIcon} />
        <AlertTitle>Integrations paused</AlertTitle>
        <AlertDescription>
          The Free plan doesn&rsquo;t include Slack, Discord, and GitHub
          integrations. Deliveries for{" "}
          {downgradeState.integrationCount === 1
            ? "your connected integration"
            : `your ${downgradeState.integrationCount} connected integrations`}{" "}
          are paused. Remove the connections you don&rsquo;t need, or upgrade to
          resume them.
        </AlertDescription>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            onClick={() =>
              router.navigate({
                to: "/$organizationId/settings/integrations",
                params: { organizationId },
              })
            }
            size="sm"
            type="button"
            variant="outline"
          >
            Review integrations
          </Button>
          <Button
            onClick={() =>
              router.navigate({
                to: "/$organizationId/settings/billing",
                params: { organizationId },
              })
            }
            size="sm"
            type="button"
            variant="outline"
          >
            Manage billing
          </Button>
        </div>
      </Alert>
    );
  }

  return null;
}
