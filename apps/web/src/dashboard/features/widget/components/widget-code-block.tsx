import { CodeBlock } from "@feeblo/ui/code-block";

import { WidgetCopyField } from "./widget-copy-field";

interface WidgetCodeBlockProps {
  code: string;
  /** Shown in the block's header, like a file name or language. */
  label: string;
  /** Rangi language id used for highlighting, e.g. `tsx` or `bash`. */
  language: string;
  className?: string;
}

/**
 * A read-only, syntax-highlighted code surface with the copy affordance
 * attached to the thing being copied. The header keeps the label visible while
 * the body scrolls.
 */
export function WidgetCodeBlock({
  className,
  code,
  label,
  language,
}: WidgetCodeBlockProps) {
  return (
    <WidgetCopyField
      className={className}
      copyLabel={`Copy ${label.toLowerCase()}`}
      copyValue={code}
      label={label}
    >
      <CodeBlock
        className="max-h-80 overflow-auto p-4 text-xs leading-relaxed"
        code={code}
        language={language}
      />
    </WidgetCopyField>
  );
}
