import { Spinner } from "@feeblo/ui/spinner";

/**
 * Route-level pending fallback for the public board.
 *
 * Server-rendered board pages arrive with their collections already hydrated,
 * so this is what a *client-side* navigation between board routes shows while
 * the target route's preloads are in flight. A centered spinner is all it
 * needs: the shell (navbar, dialogs) stays mounted around it.
 */
export function PublicBoardPending() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Spinner className="text-muted-foreground size-6" />
    </div>
  );
}
