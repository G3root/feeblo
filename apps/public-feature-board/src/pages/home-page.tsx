import { Home } from "../features/home/home";

/**
 * The board's home page.
 *
 * A plain component rather than a route: the host router owns the board's
 * routes (`apps/web/src/routes/s/...`), which is what lets the page render on
 * the server like any other Start route.
 */
export function BoardHomePage() {
  return (
    <Home.Provider>
      <Home.Root />
    </Home.Provider>
  );
}
