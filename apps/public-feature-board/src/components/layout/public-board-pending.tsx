import { Spinner } from "@feeblo/ui/spinner";

/**
 * Route-level pending fallback for the public board.
 *
 * Every public route preloads RPC-backed collections in `beforeLoad`, so a
 * pending phase is the common case whenever the query cache is cold. A
 * centered spinner is all it needs: the shell (navbar, dialogs) is already
 * mounted around it on child routes, and the server-rendered fallback paints
 * the same spinner before hydration, so the handoff is invisible.
 */
export function PublicBoardPending() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Spinner className="text-muted-foreground size-6" />
    </div>
  );
}
