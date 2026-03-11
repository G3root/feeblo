import type { Site } from "@feeblo/domain/site/schema";
import { Router } from "wouter";
import {
  getContext,
  Provider,
} from "~/integrations/tanstack-query/root-provider";
import { PublicBoardShell } from "../components/layout/public-board-shell";
import { SiteProvider } from "../providers/site-provider";
import { PublicBoardRoutes } from "./public-board-routes";

export interface PublicBoardAppProps {
  readonly basePath?: string;
  readonly site: Site;
}

export function PublicBoardApp({ basePath = "", site }: PublicBoardAppProps) {
  return (
    <Provider queryClient={getContext().queryClient}>
      <SiteProvider site={site}>
        <Router base={basePath}>
          <PublicBoardShell>
            <PublicBoardRoutes />
          </PublicBoardShell>
        </Router>
      </SiteProvider>
    </Provider>
  );
}
