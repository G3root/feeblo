import { cn } from "@feeblo/ui/utils";

/**
 * The mark from `apps/web/public/favicon.svg`, traced back to the pixel grid it
 * is drawn on: **19 columns by 19 rows**, one unit per cell, so its edges land
 * on whole pixels rather than being smeared by scaling.
 *
 * The grid is sampled from the asset's own path — the 19x19 shape above is what
 * a browser paints for `favicon.svg`, not a re-derivation of its coordinates.
 * An earlier attempt reconstructed the grid from the path's relative `m` offsets
 * and drifted a row and a column wide, which made the mark look lopsided
 * against the real one; sampling the raster is the version that cannot disagree
 * with the file.
 *
 * `viewBox` is the grid exactly, so the default size is 19px (one pixel per
 * cell) and 38px is two. Anything between is fine, it just antialiases the way
 * the favicon does at any non-multiple.
 */
const markPath =
  "M6 0h2v1h-2zM11 0h2v1h-2zM5 1h4v1h-4zM10 1h4v1h-4zM5 2h4v1h-4zM10 2h4v1h-4zM5 3h4v1h-4zM10 3h4v1h-4zM5 4h4v1h-4zM10 4h4v1h-4zM1 5h4v1h-4zM6 5h3v1h-3zM10 5h3v1h-3zM14 5h4v1h-4zM0 6h6v1h-6zM7 6h5v1h-5zM13 6h6v1h-6zM0 7h8v1h-8zM11 7h8v1h-8zM1 8h6v1h-6zM12 8h6v1h-6zM6 9h1v1h-1zM12 9h1v1h-1zM1 10h6v1h-6zM12 10h6v1h-6zM0 11h8v1h-8zM11 11h8v1h-8zM0 12h6v1h-6zM7 12h5v1h-5zM13 12h6v1h-6zM1 13h4v1h-4zM6 13h3v1h-3zM10 13h3v1h-3zM14 13h4v1h-4zM5 14h4v1h-4zM10 14h4v1h-4zM5 15h4v1h-4zM10 15h4v1h-4zM5 16h4v1h-4zM10 16h4v1h-4zM5 17h4v1h-4zM10 17h4v1h-4zM6 18h2v1h-2zM11 18h2v1h-2z";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={cn("size-[19px] shrink-0", className)}
      fill="currentColor"
      viewBox="0 0 19 19"
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
