import type { TPlanComplianceDegradedCapability } from "@feeblo/domain/plan-compliance/schema";
import { Button } from "@feeblo/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@feeblo/ui/collapsible";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { useOrganizationId } from "../../../hooks/use-organization-id";

type DegradedItem = {
  readonly capability: TPlanComplianceDegradedCapability;
  readonly title: string;
  readonly body: string;
  /** The settings page where the workspace can inspect or undo the state. */
  readonly path:
    | "/$organizationId/settings/developers"
    | "/$organizationId/settings/customize"
    | "/$organizationId/settings/integrations"
    | "/$organizationId/settings/widget"
    | null;
};

const DEGRADED_ITEMS: readonly DegradedItem[] = [
  {
    capability: "integrations",
    title: "Slack, Discord, and GitHub deliveries are paused",
    body: "Connections are kept, and outbound deliveries resume when the workspace returns to a paid plan.",
    path: "/$organizationId/settings/integrations",
  },
  {
    capability: "publicApi",
    title: "Public API keys are inactive",
    body: "Keys are kept but reject requests until the workspace is on a plan that includes the Public API.",
    path: "/$organizationId/settings/developers",
  },
  {
    capability: "removeBranding",
    title: "Feeblo branding is shown again",
    body: "The stored preference is kept; hiding the branding resumes on the next paid plan.",
    path: "/$organizationId/settings/customize",
  },
  {
    capability: "widgetSso",
    title: "Widget SSO is refused",
    body: "Identified widget sessions fall back until the widget SSO capability is available again.",
    path: "/$organizationId/settings/widget",
  },
  {
    capability: "subscriberEmails",
    title: "Subscriber emails are stopped",
    body: "Member notifications still send. Only end-user subscriber email requires the paid capability.",
    path: null,
  },
];

/**
 * The capabilities the plan no longer includes.
 *
 * They already stop working at read time, so there is nothing to fix here —
 * this explains why deliveries and integrations went quiet, which is the one
 * question the gate's audience will ask next.
 */
export function PlanComplianceDegradedSection({
  degraded,
}: {
  degraded: readonly TPlanComplianceDegradedCapability[];
}) {
  const organizationId = useOrganizationId();
  const [open, setOpen] = useState(false);
  const items = DEGRADED_ITEMS.filter((item) =>
    degraded.includes(item.capability)
  );

  if (items.length === 0) {
    return null;
  }

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger
        render={
          <Button
            className="text-muted-foreground w-full justify-between"
            type="button"
            variant="ghost"
          />
        }
      >
        What else changed when the plan ended
        <HugeiconsIcon
          className={
            open ? "rotate-180 transition-transform" : "transition-transform"
          }
          icon={ArrowDown01Icon}
        />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ul className="border-border mt-2 divide-y rounded-xl border">
          {items.map((item) => (
            <li
              className="flex flex-col gap-1 px-4 py-3 text-sm"
              key={item.capability}
            >
              <span className="font-medium">{item.title}</span>
              <span className="text-muted-foreground">{item.body}</span>
              {item.path ? (
                <Link
                  className="text-foreground text-sm underline underline-offset-4"
                  params={{ organizationId }}
                  to={item.path}
                >
                  Review the setting
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </CollapsiblePanel>
    </Collapsible>
  );
}
