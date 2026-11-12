import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useId, useRef } from "react";

import { Button, type ButtonProps } from "./button";
import { useCopyToClipboard } from "./hooks/use-clipboard";
import { anchoredToastManager } from "./toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./tooltip";

interface CopyButtonProps extends ButtonProps {
  onCopy: () => string;
  successMessage: string;
  tooltipPopup?: string;
}

export function CopyButton({
  children,
  tooltipPopup,
  successMessage,
  onCopy,
  ...rest
}: CopyButtonProps) {
  const id = useId();
  const copyButtonRef = useRef<HTMLButtonElement>(null);

  const { copyToClipboard, isCopied } = useCopyToClipboard({
    onCopy: () => {
      if (copyButtonRef.current) {
        anchoredToastManager.add({
          id,
          data: {
            tooltipStyle: true,
          },
          positionerProps: {
            anchor: copyButtonRef.current,
          },
          timeout: 2000,
          title: successMessage,
        });
      }
    },
    timeout: 2000,
  });

  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <Button
            {...props}
            {...rest}
            disabled={isCopied}
            onClick={() => {
              copyToClipboard(onCopy());
            }}
            ref={copyButtonRef}
          >
            {/* Keyed so the swap is a remount: without it React reuses the
                <svg> and `@starting-style` never fires, so the tick would just
                replace the copy icon's paths. */}
            <span
              className="ease-out-strong flex transition-[scale,opacity] duration-150 motion-reduce:transition-opacity starting:scale-80 starting:opacity-0 motion-reduce:starting:scale-100"
              key={isCopied ? "copied" : "copy"}
            >
              <HugeiconsIcon icon={isCopied ? Tick02Icon : Copy01Icon} />
            </span>
            {children}
          </Button>
        )}
      />
      {tooltipPopup ? <TooltipPopup>{tooltipPopup}</TooltipPopup> : null}
    </Tooltip>
  );
}
