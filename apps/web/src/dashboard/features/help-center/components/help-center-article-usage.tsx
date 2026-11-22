import { PLAN_ENTITLEMENTS } from "@feeblo/domain/plan-entitlements";
import { Button } from "@feeblo/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@feeblo/ui/popover";
import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { usePlan } from "~/hooks/use-plan";

/**
 * Hover explainer for the article limit: what counts and what the plan
 * includes.
 *
 * The limit is per workspace, not per section, which is the part an editor is
 * likely to misread on a page that shows one section at a time.
 */
function ArticleLimitInfoPopover({ limit }: { limit: number }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        render={
          <Button
            aria-label="What counts toward the article limit?"
            size="icon-xs"
            variant="ghost"
          />
        }
      >
        <HugeiconsIcon icon={InformationCircleIcon} />
      </PopoverTrigger>
      <PopoverPopup side="top" tooltipStyle>
        <p className="max-w-64 text-balance">
          Every article counts toward the same limit, whichever section holds
          it. Your plan includes {limit} articles — upgrade for unlimited.
        </p>
      </PopoverPopup>
    </Popover>
  );
}

/**
 * The plan's article allowance, shown only when it is a number.
 *
 * A paid workspace's limit is `null`, and rendering "unlimited" on every plan
 * that has no cap is noise on a page an editor already understands.
 */
export function HelpCenterArticleUsage({ used }: { used: number }) {
  const planQuery = usePlan();
  const plan = planQuery.data?.plan ?? "free";
  const limit = PLAN_ENTITLEMENTS[plan].limits.helpCenterArticles;

  if (limit === null) {
    return null;
  }

  const atLimit = used >= limit;

  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
      <span>
        {used} of {limit} articles used
        {atLimit ? " — upgrade for unlimited" : ""}
      </span>
      <ArticleLimitInfoPopover limit={limit} />
    </p>
  );
}
