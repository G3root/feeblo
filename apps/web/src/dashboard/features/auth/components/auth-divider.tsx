import type { ReactNode } from "react";

/**
 * The rule between the social buttons and the email form.
 *
 * A hairline each side of a short label, rather than a single rule with the
 * label floated over it: the gap carries the meaning ("these two routes are
 * alternatives"), so the lines only have to frame it.
 */
export function AuthDivider({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground flex items-center gap-3 text-xs">
      <span aria-hidden className="bg-border h-px flex-1" />
      <span>{children}</span>
      <span aria-hidden className="bg-border h-px flex-1" />
    </div>
  );
}
