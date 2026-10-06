import { CopyButton } from "@feeblo/ui/copy-button";
import { cn } from "@feeblo/ui/utils";
import type { ReactNode } from "react";

interface WidgetCopyFieldProps {
  /** The rendered value. */
  children: ReactNode;
  className?: string;
  /** Accessible name for the copy button, e.g. "Copy secret". */
  copyLabel: string;
  /** The payload written to the clipboard. */
  copyValue: string;
  /** Shown in the field's header, like a language or a variable name. */
  label: string;
}

/**
 * A bordered value surface with the copy affordance attached to the value's
 * header. Shared by the install snippets and the identity secret so the copy
 * button and its success feedback are defined once.
 */
export function WidgetCopyField({
  children,
  className,
  copyLabel,
  copyValue,
  label,
}: WidgetCopyFieldProps) {
  return (
    <div
      className={cn(
        "bg-muted/40 overflow-hidden rounded-xl border shadow-xs/5",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b py-1.5 pr-1.5 pl-3">
        <span className="text-muted-foreground font-mono text-xs">{label}</span>
        <CopyButton
          aria-label={copyLabel}
          onCopy={() => copyValue}
          size="xs"
          successMessage={`${label} copied`}
          tooltipPopup={copyLabel}
          variant="ghost"
        >
          Copy
        </CopyButton>
      </div>
      {children}
    </div>
  );
}
