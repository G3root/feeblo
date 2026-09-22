/**
 * Boundary declaration for the public board package.
 *
 * `@feeblo/public-feature-board` is a self-contained TanStack Router app: its
 * router registers itself in `@tanstack/react-router`'s global `Register`
 * interface. Pulling its sources into this app's program would register two
 * different routers in one program — a conflict with no correct resolution,
 * because each app's links are only valid against its own route tree.
 *
 * This app consumes the board as a black box, so the module is declared here
 * with exactly the surface `public-board-island.tsx` uses. The real package
 * (and its router) is what Vite bundles; this declaration only shapes
 * typechecking. Keep it in sync with `apps/public-feature-board/src/index.ts`
 * and `src/i18n.ts`.
 */
declare module "@feeblo/public-feature-board" {
  import type { Locale, SetLocaleFn } from "@/paraglide/runtime.js";

  export interface PublicBoardAppProps {
    readonly site: import("@feeblo/domain/site/schema").TSite;
  }

  export function PublicBoardApp(
    props: PublicBoardAppProps
  ): import("react").ReactElement;

  export interface PublicBoardI18nRuntime {
    getLocale: () => Locale;
    setLocale: SetLocaleFn;
  }

  export function initPublicBoardI18n(
    runtime: PublicBoardI18nRuntime
  ): void;

  export function isPublicBoardI18nInitialized(): boolean;
}
