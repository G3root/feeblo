import { cn } from "@feeblo/ui/utils";

/**
 * The mark from `public/favicon.svg`, traced back to the pixel grid it is
 * drawn on: 20 columns by 21 rows, one unit per cell, so every cell is exactly
 * one pixel at `size-6` (and two at `size-12`). The favicon draws it as a
 * white glyph on a black square; here it is `currentColor` with the square
 * dropped, because the surface it sits on already supplies both.
 *
 * The `viewBox` is offset by half a unit so the 20x21 grid sits centred in a
 * square 24-unit box — a square box is what makes the size utilities above
 * land on whole pixels instead of a fraction of one.
 */
const markPath =
  "M7 0h2v1h-2zM12 0h2v1h-2zM6 1h4v1h-4zM11 1h4v1h-4zM6 2h4v1h-4zM11 2h4v1h-4zM6 3h4v1h-4zM11 3h4v1h-4zM6 4h4v1h-4zM11 4h4v1h-4zM2 5h2v1h-2zM5 5h1v1h-1zM7 5h3v1h-3zM11 5h3v1h-3zM15 5h3v1h-3zM1 6h1v1h-1zM18 6h1v1h-1zM0 7h4v1h-4zM5 7h2v1h-2zM8 7h5v1h-5zM14 7h6v1h-6zM0 8h4v1h-4zM5 8h4v1h-4zM12 8h8v1h-8zM1 9h4v1h-4zM6 9h2v1h-2zM13 9h6v1h-6zM7 10h1v1h-1zM13 10h1v1h-1zM1 11h4v1h-4zM6 11h2v1h-2zM13 11h6v1h-6zM0 12h5v1h-5zM6 12h3v1h-3zM12 12h8v1h-8zM0 13h5v1h-5zM6 13h1v1h-1zM8 13h5v1h-5zM14 13h6v1h-6zM1 14h4v1h-4zM7 14h3v1h-3zM11 14h3v1h-3zM15 14h4v1h-4zM7 15h3v1h-3zM11 15h4v1h-4zM6 16h1v1h-1zM6 17h4v1h-4zM11 17h4v1h-4zM6 18h4v1h-4zM11 18h4v1h-4zM6 19h4v1h-4zM11 19h4v1h-4zM7 20h2v1h-2zM12 20h2v1h-2z";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={cn("size-6 shrink-0", className)}
      fill="currentColor"
      viewBox="-2 -1.5 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={markPath} />
    </svg>
  );
}

/**
 * Mark plus wordmark. The wordmark is set in the heading face at the same
 * weight the mark is drawn at, so the two read as one lockup rather than a
 * logo with a label next to it.
 */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "text-foreground inline-flex items-center gap-2",
        className
      )}
      data-slot="brand-lockup"
    >
      <BrandMark />
      <span className="text-[15px] font-semibold tracking-[-0.015em]">
        feeblo
      </span>
    </span>
  );
}
