import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import {
  createDashboardCollections,
  type DashboardCollections,
} from "../lib/collections";

const DashboardCollectionsContext = createContext<DashboardCollections | null>(
  null
);

export function DashboardCollectionsProvider({
  children,
  organizationId,
}: {
  children: ReactNode;
  organizationId: string;
}) {
  const queryClient = useQueryClient();
  const collections = useMemo(
    () => createDashboardCollections({ organizationId, queryClient }),
    [organizationId, queryClient]
  );

  return (
    <DashboardCollectionsContext.Provider value={collections}>
      {children}
    </DashboardCollectionsContext.Provider>
  );
}

export function useDashboardCollections() {
  const collections = useContext(DashboardCollectionsContext);

  if (!collections) {
    throw new Error("Dashboard collections not found");
  }

  return collections;
}
