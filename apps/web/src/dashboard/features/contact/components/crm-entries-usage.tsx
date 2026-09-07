import { Button } from "@feeblo/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@feeblo/ui/popover";
import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

/**
 * Hover explainer for the CRM entry limit: what counts as an entry and
 * what the plan includes. Shared by the usage line and the at-limit
 * dead-ends in the create dialogs so the copy cannot drift.
 */
export function CrmLimitInfoPopover({ crmLimit }: { crmLimit: number }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        render={
          <Button
            aria-label="What counts as a CRM entry?"
            size="icon-xs"
            variant="ghost"
          />
        }
      >
        <HugeiconsIcon icon={InformationCircleIcon} />
      </PopoverTrigger>
      <PopoverPopup side="top" tooltipStyle>
        <p className="max-w-64 text-balance">
          Each contact and each company counts as one CRM entry. Your plan
          includes {crmLimit} entries — upgrade for unlimited.
        </p>
      </PopoverPopup>
    </Popover>
  );
}

type CrmEntriesUsageProps = {
  crmLimit: number | null;
  totalCrmEntries: number;
};

export function CrmEntriesUsage({
  crmLimit,
  totalCrmEntries,
}: CrmEntriesUsageProps) {
  if (crmLimit === null) {
    return null;
  }

  const hasReachedCrmLimit = totalCrmEntries >= crmLimit;

  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
      <span>
        {totalCrmEntries} of {crmLimit} CRM entries used
        {hasReachedCrmLimit ? " — upgrade for unlimited" : ""}
      </span>
      <CrmLimitInfoPopover crmLimit={crmLimit} />
    </p>
  );
}
