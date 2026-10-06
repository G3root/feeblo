import { CopyButton } from "@feeblo/ui/copy-button";
import { cn } from "@feeblo/ui/utils";

interface WidgetCodeBlockProps {
  code: string;
  /** Shown in the block's header, like a file name or language. */
  label: string;
  className?: string;
}

/**
 * A read-only code surface with the copy affordance attached to the thing
 * being copied. The header keeps the label visible while the body scrolls.
 */
export function WidgetCodeBlock({
  className,
  code,
  label,
}: WidgetCodeBlockProps) {
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
          onCopy={() => code}
          size="xs"
          successMessage={`${label} copied`}
          tooltipPopup={`Copy ${label.toLowerCase()}`}
          variant="ghost"
        >
          Copy
        </CopyButton>
      </div>
      <pre
        className="max-h-80 overflow-auto p-4 font-mono text-xs leading-relaxed"
        tabIndex={0}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
