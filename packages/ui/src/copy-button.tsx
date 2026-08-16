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
            <HugeiconsIcon icon={isCopied ? Tick02Icon : Copy01Icon} />
            {children}
          </Button>
        )}
      />
      {tooltipPopup ? <TooltipPopup>{tooltipPopup}</TooltipPopup> : null}
    </Tooltip>
  );
}
