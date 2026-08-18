import { usePostCollectionData } from "@feeblo/post-ui/post-page-context";
import { Button } from "@feeblo/ui/button";
import { Calendar } from "@feeblo/ui/calendar";
import { Popover, PopoverPopup, PopoverTrigger } from "@feeblo/ui/popover";
import { toastManager } from "@feeblo/ui/toast";
import { cn } from "@feeblo/ui/utils";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { Calendar03Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createOptimisticAction } from "@tanstack/react-db";
import { useState } from "react";

import { fetchRpc } from "~/lib/runtime";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

const QUARTERS = [1, 2, 3, 4] as const;
const ETA_PATTERN = /^(\d{4})-Q([1-4])$/;

function parseEtaQuarter(value: string | null) {
  const match = value?.match(ETA_PATTERN);
  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    quarter: Number(match[2]),
  };
}

function formatEtaQuarter(value: string | null) {
  const parsed = parseEtaQuarter(value);
  return parsed ? `Q${parsed.quarter} ${parsed.year}` : "Set ETA";
}

function getQuarterDate(value: string | null) {
  const parsed = parseEtaQuarter(value);
  return parsed
    ? new Date(parsed.year, (parsed.quarter - 1) * 3, 1)
    : undefined;
}

function getQuarterValue(year: number, quarter: number) {
  return `${String(year).padStart(4, "0")}-Q${quarter}`;
}

export function PostEtaField({ disabled = false }: { disabled?: boolean }) {
  const { post, isLocked, organizationId } = usePostCollectionData();
  const { postCollection } = useDashboardCollections();
  // Backend mirror: PostPolicy.canUpdateEta lets `posts.status` holders
  // (managers and above) set the ETA via PostUpdateEta.
  const { allowed: canUpdateEta } = usePolicy(
    hasPermission(organizationId, "posts.status")
  );
  const selectedDate = getQuarterDate(post.etaQuarter);
  const [month, setMonth] = useState(selectedDate ?? new Date());
  const [open, setOpen] = useState(false);
  const isDisabled = disabled || isLocked || !canUpdateEta;

  const updatePostEta = createOptimisticAction<{ etaQuarter: string | null }>({
    onMutate: ({ etaQuarter }) => {
      postCollection.update(post.id, (draft) => {
        draft.etaQuarter = etaQuarter;
      });
    },
    mutationFn: async ({ etaQuarter }) => {
      await fetchRpc((rpc) =>
        rpc.PostUpdateEta({
          id: post.id,
          organizationId,
          etaQuarter,
        })
      );

      await postCollection.utils.refetch();
    },
  });

  const updateEta = async (etaQuarter: string | null) => {
    if (isDisabled || etaQuarter === post.etaQuarter) {
      setOpen(false);
      return;
    }

    try {
      const transaction = updatePostEta({ etaQuarter });
      await transaction.isPersisted.promise;
      trackEvent("post_updated", { field: "eta", success: true });
      toastManager.add({
        title: etaQuarter ? "ETA updated" : "ETA cleared",
        type: "success",
      });
      setOpen(false);
    } catch {
      trackEvent("post_updated", { field: "eta", success: false });
      toastManager.add({
        title: "Failed to update ETA",
        type: "error",
      });
    }
  };

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setMonth(selectedDate ?? new Date());
        }
        setOpen(nextOpen);
      }}
      open={open}
    >
      <PopoverTrigger
        render={
          <Button
            aria-label={`ETA: ${formatEtaQuarter(post.etaQuarter)}`}
            className="w-full justify-start"
            disabled={isDisabled}
            size="sm"
            variant="outline"
          />
        }
      >
        <HugeiconsIcon
          className="text-primary-blue"
          icon={Calendar03Icon}
          strokeWidth={2}
        />
        <span className={cn(!post.etaQuarter && "text-muted-foreground")}>
          {formatEtaQuarter(post.etaQuarter)}
        </span>
      </PopoverTrigger>
      <PopoverPopup align="end" side="bottom">
        <div className="flex max-sm:flex-col">
          <div className="relative py-1 ps-1 max-sm:order-1 max-sm:border-t">
            <div className="flex h-full flex-col sm:border-e sm:pe-3">
              <p className="text-muted-foreground px-2 pb-1 text-xs font-medium">
                {month.getFullYear()}
              </p>
              {QUARTERS.map((quarter) => {
                const value = getQuarterValue(month.getFullYear(), quarter);
                const selected = value === post.etaQuarter;
                return (
                  <Button
                    aria-pressed={selected}
                    className="w-full justify-start"
                    key={quarter}
                    onClick={() => updateEta(value)}
                    size="sm"
                    variant={selected ? "secondary" : "ghost"}
                  >
                    Q{quarter}
                  </Button>
                );
              })}

              {post.etaQuarter ? (
                <Button
                  className="text-muted-foreground mt-auto w-full justify-start"
                  onClick={() => updateEta(null)}
                  size="sm"
                  variant="ghost"
                >
                  <HugeiconsIcon icon={Cancel01Icon} />
                  Clear ETA
                </Button>
              ) : null}
            </div>
          </div>

          <div>
            <p className="text-muted-foreground px-3 pt-2 text-xs">
              Choose a date to set its quarter
            </p>
            <Calendar
              className="max-sm:pb-3 sm:ps-2"
              mode="single"
              month={month}
              onMonthChange={setMonth}
              onSelect={(date) => {
                if (date) {
                  return updateEta(
                    getQuarterValue(
                      date.getFullYear(),
                      Math.floor(date.getMonth() / 3) + 1
                    )
                  );
                }
                return undefined;
              }}
              selected={selectedDate}
            />
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
