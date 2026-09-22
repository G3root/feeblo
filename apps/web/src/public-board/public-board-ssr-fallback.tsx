/**
 * Server-rendered loading indicator for the public board.
 *
 * The board is a client-rendered SPA (its own TanStack Router inside
 * `PublicBoardApp`), so without this the document paints nothing until its JS
 * loads, hydrates, and leaves the router's pending phase. This fallback paints
 * a spinner on first byte — the same loader-circle glyph and container as the
 * pending component (`public-board-pending.tsx`), so the swap does not flicker.
 *
 * It is removed by the app after its first commit, not by an island hydration
 * event: the app mounts inside a React transition, so that event fires before
 * React paints — removing the fallback there would open a blank frame between
 * the two spinners. Visitors without JS keep the fallback, which reads as a
 * loading page rather than an empty one.
 */
export function PublicBoardSsrFallback() {
  return (
    <div
      className="flex min-h-[70vh] items-center justify-center"
      data-board-ssr-fallback
      role="status"
    >
      <span className="sr-only">Loading</span>
      <svg
        aria-hidden="true"
        className="text-muted-foreground size-6 animate-spin"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    </div>
  );
}
