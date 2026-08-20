import {
  Roadmap,
  type RoadmapSwitcherOption,
} from "@feeblo/post-ui/roadmap/roadmap-page-layout";
import type { RoadmapBoardPost } from "@feeblo/post-ui/roadmap/types";
import type { RoadmapLane } from "@feeblo/post-ui/roadmap/types";
import { useRoadmapData } from "@feeblo/post-ui/roadmap/use-roadmap-data";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { useNavigate } from "@tanstack/react-router";
import { createContext, use, useCallback, useMemo } from "react";

import {
  boardCollection,
  postCollection,
  postStatusCollection,
  roadmapCollection,
  roadmapColumnCollection,
} from "~/lib/collections";

import { RoadmapBoard } from "./roadmap-board";
import { RoadmapDetailActions } from "./roadmap-detail-states";
import { RoadmapEmptyState } from "./roadmap-list-states";

// ---------------------------------------------------------------------------
// Generic context interface — state / actions / meta (dependency injection)
// Provider is the only place that knows if state is local, fetched, or synced.
// UI consumes the interface, not the implementation.
// ---------------------------------------------------------------------------

interface RoadmapDashboardState {
  allRoadmaps: RoadmapSwitcherOption[];
  displayedRoadmap:
    | (RoadmapSwitcherOption & {
        description: string | null;
        visibility: "public" | "private";
      })
    | null;
  isError: boolean;
  isLoading: boolean;
  lanes: RoadmapLane<RoadmapBoardPost>[];
}

interface RoadmapDashboardActions {
  switchRoadmap: (slug: string) => void;
}

interface RoadmapDashboardMeta {
  organizationId: string;
}

interface RoadmapDashboardContextValue {
  actions: RoadmapDashboardActions;
  meta: RoadmapDashboardMeta;
  state: RoadmapDashboardState;
}

const RoadmapDashboardContext =
  createContext<RoadmapDashboardContextValue | null>(null);

function useRoadmapDashboard() {
  const ctx = use(RoadmapDashboardContext);
  if (!ctx) throw new Error("Must be used within RoadmapDashboardProvider");
  return ctx;
}

// --- Providers — lift state, decouple implementation ---

function DashboardRoadmapIndexProvider({
  children,
  organizationId,
}: {
  children: React.ReactNode;
  organizationId: string;
}) {
  const navigate = useNavigate();
  const { allRoadmaps, isError, isLoading, lanesFor, roadmaps } =
    useRoadmapData({
      boardCollection,
      postCollection,
      postStatusCollection,
      roadmapCollection,
      roadmapColumnCollection,
      organizationId,
    });

  const displayedRoadmap = roadmaps[0] ?? null;
  const lanes = useMemo(
    () => (displayedRoadmap ? lanesFor(displayedRoadmap.id) : []),
    [displayedRoadmap, lanesFor],
  );

  const switchRoadmap = useCallback(
    (nextSlug: string) => {
      const primarySlug = allRoadmaps[0]?.slug;
      if (nextSlug === primarySlug) {
        navigate({
          to: "/$organizationId/roadmap",
          params: { organizationId },
        });
      } else {
        navigate({
          params: { organizationId, slug: nextSlug },
          to: "/$organizationId/roadmap/$slug",
        });
      }
    },
    [allRoadmaps, navigate, organizationId],
  );

  const value = useMemo<RoadmapDashboardContextValue>(
    () => ({
      actions: { switchRoadmap },
      meta: { organizationId },
      state: {
        allRoadmaps,
        // SAFETY: displayedRoadmap derives from roadmaps[0] via useRoadmapData; its shape matches RoadmapDashboardState['displayedRoadmap'] (id/name/slug/visibility/description).
        displayedRoadmap:
          displayedRoadmap as RoadmapDashboardState["displayedRoadmap"],
        isError,
        isLoading,
        lanes,
      },
    }),
    [
      switchRoadmap,
      organizationId,
      allRoadmaps,
      displayedRoadmap,
      isError,
      isLoading,
      lanes,
    ],
  );

  return (
    <RoadmapDashboardContext.Provider value={value}>
      {children}
    </RoadmapDashboardContext.Provider>
  );
}

function DashboardRoadmapDetailProvider({
  children,
  organizationId,
  slug,
}: {
  children: React.ReactNode;
  organizationId: string;
  slug: string;
}) {
  const navigate = useNavigate();
  const { allRoadmaps, isError, isLoading, lanesFor, roadmaps } =
    useRoadmapData({
      boardCollection,
      postCollection,
      postStatusCollection,
      roadmapCollection,
      roadmapColumnCollection,
      organizationId,
      slug,
    });

  const displayedRoadmap = roadmaps[0] ?? null;
  const lanes = useMemo(
    () => (displayedRoadmap ? lanesFor(displayedRoadmap.id) : []),
    [displayedRoadmap, lanesFor],
  );

  const switchRoadmap = useCallback(
    (nextSlug: string) => {
      const primarySlug = allRoadmaps[0]?.slug;
      if (nextSlug === primarySlug) {
        navigate({
          to: "/$organizationId/roadmap",
          params: { organizationId },
        });
      } else {
        navigate({
          params: { organizationId, slug: nextSlug },
          to: "/$organizationId/roadmap/$slug",
        });
      }
    },
    [allRoadmaps, navigate, organizationId],
  );

  const value = useMemo<RoadmapDashboardContextValue>(
    () => ({
      actions: { switchRoadmap },
      meta: { organizationId },
      state: {
        allRoadmaps,
        // SAFETY: displayedRoadmap derives from roadmaps[0] via useRoadmapData; its shape matches RoadmapDashboardState['displayedRoadmap'] (id/name/slug/visibility/description).
        displayedRoadmap:
          displayedRoadmap as RoadmapDashboardState["displayedRoadmap"],
        isError,
        isLoading,
        lanes,
      },
    }),
    [
      switchRoadmap,
      organizationId,
      allRoadmaps,
      displayedRoadmap,
      isError,
      isLoading,
      lanes,
    ],
  );

  return (
    <RoadmapDashboardContext.Provider value={value}>
      {children}
    </RoadmapDashboardContext.Provider>
  );
}

// --- Explicit UI variants — no boolean props, no hidden conditionals ---

function RoadmapDashboardError() {
  return (
    <Roadmap.Container>
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>Roadmap unavailable</EmptyTitle>
          <EmptyDescription>
            There was a problem loading the roadmap.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </Roadmap.Container>
  );
}

function RoadmapDashboardNotFound() {
  return (
    <Roadmap.Container>
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>Roadmap not found</EmptyTitle>
          <EmptyDescription>
            This roadmap does not exist or has been removed.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </Roadmap.Container>
  );
}

function RoadmapDashboardContent() {
  const {
    actions: { switchRoadmap },
    meta: { organizationId },
    state: { allRoadmaps, displayedRoadmap, lanes },
  } = useRoadmapDashboard();

  if (!displayedRoadmap) return null;

  return (
    <Roadmap.Provider
      description={displayedRoadmap.description}
      onValueChange={switchRoadmap}
      options={allRoadmaps}
      title={displayedRoadmap.name}
      value={displayedRoadmap.slug}
    >
      <Roadmap.Container>
        <Roadmap.Section>
          <Roadmap.Header>
            <Roadmap.HeaderMain>
              <Roadmap.Title />
              <Roadmap.Description />
            </Roadmap.HeaderMain>
            <Roadmap.HeaderActions>
              <Roadmap.Switcher />
              <RoadmapDetailActions
                roadmapId={displayedRoadmap.id}
                visibility={displayedRoadmap.visibility}
              />
            </Roadmap.HeaderActions>
          </Roadmap.Header>

          {lanes.length > 0 ? (
            <RoadmapBoard lanes={lanes} organizationId={organizationId} />
          ) : (
            <Roadmap.NoColumnsEmpty />
          )}
        </Roadmap.Section>
      </Roadmap.Container>
    </Roadmap.Provider>
  );
}

function RoadmapDashboardViewContent() {
  const {
    state: { displayedRoadmap, isError, isLoading },
  } = useRoadmapDashboard();

  if (isError) return <RoadmapDashboardError />;
  if (isLoading) return <Roadmap.Skeleton />;
  if (!displayedRoadmap) return <RoadmapEmptyState />;
  return <RoadmapDashboardContent />;
}

function RoadmapDashboardViewContentWithNotFound() {
  const {
    state: { displayedRoadmap, isError, isLoading },
  } = useRoadmapDashboard();

  if (isError) return <RoadmapDashboardError />;
  if (isLoading) return <Roadmap.Skeleton />;
  if (!displayedRoadmap) return <RoadmapDashboardNotFound />;
  return <RoadmapDashboardContent />;
}

// --- Explicit variant exports — no optional `slug` boolean ---

export function DashboardRoadmapIndexView({
  organizationId,
}: {
  organizationId: string;
}) {
  return (
    <DashboardRoadmapIndexProvider organizationId={organizationId}>
      <RoadmapDashboardViewContent />
    </DashboardRoadmapIndexProvider>
  );
}

export function DashboardRoadmapDetailView({
  organizationId,
  slug,
}: {
  organizationId: string;
  slug: string;
}) {
  return (
    <DashboardRoadmapDetailProvider organizationId={organizationId} slug={slug}>
      <RoadmapDashboardViewContentWithNotFound />
    </DashboardRoadmapDetailProvider>
  );
}

// Back-compat — delegates to explicit variants
export function DashboardRoadmapView({
  organizationId,
  slug,
}: {
  organizationId: string;
  slug?: string;
}) {
  if (slug === undefined) {
    return <DashboardRoadmapIndexView organizationId={organizationId} />;
  }
  return (
    <DashboardRoadmapDetailView organizationId={organizationId} slug={slug} />
  );
}
