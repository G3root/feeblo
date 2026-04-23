import type { Site } from "@feeblo/domain/site/schema";
import { Router } from "wouter";
import {
  getContext,
  Provider,
} from "~/integrations/tanstack-query/root-provider";
import { PublicBoardShell } from "../components/layout/public-board-shell";
import { PublicCollectionsProvider } from "../providers/public-collections-provider";
import { SiteProvider } from "../providers/site-provider";
import { PublicBoardRoutes } from "./public-board-routes";

export interface PublicBoardAppProps {
  readonly basePath?: string;
  readonly site: Site;
}

const queryClient = getContext().queryClient;

export function PublicBoardApp({ basePath = "", site }: PublicBoardAppProps) {
  return (
    <Provider queryClient={queryClient}>
      <SiteProvider site={site}>
        <PublicCollectionsProvider organizationId={site.organizationId}>
          <Router base={basePath}>
            <PublicBoardShell>
              <PublicBoardRoutes />
            </PublicBoardShell>
          </Router>
        </PublicCollectionsProvider>
      </SiteProvider>
    </Provider>
  );
}
