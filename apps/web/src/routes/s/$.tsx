import { NotFoundPage } from "@feeblo/public-feature-board/pages/not-found";
import { createFileRoute } from "@tanstack/react-router";

/**
 * Unknown paths on a board host.
 *
 * A real not-found page, rendered inside the board shell: the layout above
 * resolves the site (an unknown subdomain is a 404 from there, not from here).
 */
export const Route = createFileRoute("/s/$")({
  component: NotFoundPage,
});
