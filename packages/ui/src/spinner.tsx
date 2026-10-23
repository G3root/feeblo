import type React from "react";

import { cn } from "./utils";

/**
 * The indeterminate spinner.
 *
 * Drawn here rather than taken from an icon set: this component is the
 * router's default pending placeholder (`DashboardRoutePending`) and `Button`'s
 * loading indicator, so it is imported by the app's entry graph on every
 * route. A single glyph is not a reason to put an icon library on that path,
 * and the stroke geometry is two attributes' worth of markup.
 *
 * `width`/`height` are explicit for the callers that pass no `size-*` class: an
 * inline `<svg>` with only a `viewBox` falls back to the 300×150
 * replaced-element size.
 */
export function Spinner({
  className,
  ...props
}: React.ComponentProps<"svg">): React.ReactElement {
  return (
    <svg
      aria-label="Loading"
      className={cn("animate-spin", className)}
      fill="none"
      height="24"
      role="status"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
