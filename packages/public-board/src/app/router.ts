import { createRouter } from "sv-router";
import PublicBoardShell from "../components/layout/public-board-shell.svelte";
import HomePage from "../routes/home-page.svelte";

export const router = createRouter({
  layout: PublicBoardShell,
  "/": HomePage,
  "/roadmap": () => import("../routes/roadmap-page.svelte"),
  "/p/:slug": () => import("../routes/post-page.svelte"),
});

export const { isActive, navigate, p, route } = router;
