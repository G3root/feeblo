import { Button } from "@feeblo/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@feeblo/ui/popover";
import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

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
            Each contact and each company counts as one CRM entry. Free plan
            includes {crmLimit} entries — upgrade for unlimited.
          </p>
        </PopoverPopup>
      </Popover>
    </p>
  );
}
