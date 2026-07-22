import type { TSite } from "@feeblo/domain/site/schema";
import { AuthDialogProvider } from "@feeblo/post-ui/dialog-stores";
import { AuthProvider } from "@feeblo/web-shared/auth-context";
import type { AuthHint } from "@feeblo/web-shared/auth-hint";
import { RouterProvider } from "@tanstack/react-router";
import {
  getContext,
  Provider,
} from "../integrations/tanstack-query/root-provider";
import { SiteProvider } from "../providers/site-provider";
import { router } from "./public-board-router";

export interface PublicBoardAppProps {
  readonly initialHint?: AuthHint | null;
  readonly site: TSite;
}

export function PublicBoardApp({ initialHint, site }: PublicBoardAppProps) {
  return (
    <AuthProvider initialHint={initialHint}>
      <AuthDialogProvider>
        <Provider queryClient={getContext().queryClient}>
          <SiteProvider site={site}>
            <RouterProvider router={router} />
          </SiteProvider>
        </Provider>
      </AuthDialogProvider>
    </AuthProvider>
  );
}
