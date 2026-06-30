import type { TSite } from "@feeblo/domain/site/schema";
import { RouterProvider } from "@tanstack/react-router";
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
  return (
    <Provider queryClient={getContext().queryClient}>
      <SiteProvider site={site}>
        <RouterProvider router={router} />
      </SiteProvider>
    </Provider>
  );
}
