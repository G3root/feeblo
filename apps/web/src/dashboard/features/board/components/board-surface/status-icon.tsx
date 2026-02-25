import { HugeiconsIcon } from "@hugeicons/react";
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
    <span
      className="inline-flex items-center justify-center"
      style={{ color: toneVar }}
    >
      <HugeiconsIcon className="size-4" icon={Icon} strokeWidth={2} />
    </span>
  );
}
