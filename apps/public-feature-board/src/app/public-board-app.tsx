import type { TSite } from "@feeblo/domain/site/schema";
import { AuthDialogProvider } from "@feeblo/post-ui/dialog-stores";
import { AnchoredToastProvider, ToastProvider } from "@feeblo/ui/toast";
import { AuthProvider } from "@feeblo/web-shared/auth-context";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect } from "react";

import {
  getContext,
  Provider,
} from "../integrations/tanstack-query/root-provider";
import { SiteProvider } from "../providers/site-provider";
import { router } from "./public-board-router";

export interface PublicBoardAppProps {
  readonly site: TSite;
}

export function PublicBoardApp({ site }: PublicBoardAppProps) {
  // The Astro host ships a server-rendered skeleton so the document paints
  // before this bundle arrives (`public-board-ssr-fallback.astro`). This
  // effect runs after the first commit — the router's pending skeleton is
  // already on screen — so dropping the host fallback here hands off without
  // a blank frame.
  useEffect(() => {
    document.querySelector("[data-board-ssr-fallback]")?.remove();
  }, []);

  return (
    <AuthProvider>
      <AuthDialogProvider>
        <Provider queryClient={getContext().queryClient}>
          <SiteProvider site={site}>
            {/* Anchored toasts render the subscribe feedback next to the
                toggle; global toasts surface persistence failures. */}
            <ToastProvider>
              <AnchoredToastProvider>
                <RouterProvider router={router} />
              </AnchoredToastProvider>
            </ToastProvider>
          </SiteProvider>
        </Provider>
      </AuthDialogProvider>
    </AuthProvider>
  );
}
