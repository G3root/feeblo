import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "~/lib/utils";
import { type BoardPostStatus, IconMap } from "../../constants";

export function StatusIcon({
  status,
  toneVar,
}: {
  status: BoardPostStatus;
  toneVar: string;
}) {
  const Icon = IconMap[status];

  return (
    <span className={cn("inline-flex items-center justify-center", toneVar)}>
      <HugeiconsIcon className="size-4" icon={Icon} strokeWidth={2.5} />
    </span>
  );
}
