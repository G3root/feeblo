import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "./utils";

function Spinner({
  className,
  ...props
}: Omit<React.ComponentProps<typeof HugeiconsIcon>, "icon">) {
  return (
    <div className="animate-spin">
      <HugeiconsIcon
        aria-label="Loading"
        className={cn("size-4", className)}
        icon={Loading03Icon}
        role="status"
        strokeWidth={2}
        {...props}
      />
    </div>
  );
}

export { Spinner };
