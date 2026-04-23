import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import {
  createPublicCollections,
  type PublicCollections,
} from "../lib/collections";

const PublicCollectionsContext = createContext<PublicCollections | null>(null);

export function PublicCollectionsProvider({
  children,
  organizationId,
}: {
  children: ReactNode;
  organizationId: string;
}) {
  const queryClient = useQueryClient();
  const collections = useMemo(
    () => createPublicCollections({ organizationId, queryClient }),
    [organizationId, queryClient]
  );

  return (
    <PublicCollectionsContext.Provider value={collections}>
      {children}
    </PublicCollectionsContext.Provider>
  );
}

export function usePublicCollections() {
  const collections = useContext(PublicCollectionsContext);

  if (!collections) {
    throw new Error("Public collections not found");
  }

  return collections;
}
