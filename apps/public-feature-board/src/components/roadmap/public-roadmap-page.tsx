import { RoadmapGrid } from "@feeblo/post-ui/roadmap/roadmap-grid";
import { PublicRoadmapIssueCard } from "@feeblo/post-ui/roadmap/roadmap-issue-card";
import { Roadmap } from "@feeblo/post-ui/roadmap/roadmap-page-layout";
import type {
  RoadmapBoardPost,
  RoadmapLane,
} from "@feeblo/post-ui/roadmap/types";
import {
  type RoadmapSummary,
  useRoadmapData,
} from "@feeblo/post-ui/roadmap/use-roadmap-data";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { useNavigate } from "@tanstack/react-router";
import { createContext, use, useCallback, useMemo } from "react";

import { usePublicCollections } from "../../providers/public-collections-provider";
import { useSite } from "../../providers/site-provider";

// --- Generic context (state / actions / meta) — provider decouples implementation ---

interface PublicRoadmapState {
  allRoadmaps: RoadmapSummary[];
  displayedRoadmap: RoadmapSummary | null;
  lanes: RoadmapLane<RoadmapBoardPost>[];
  isError: boolean;
  isLoading: boolean;
}

interface PublicRoadmapActions {
  openPost: (slug: string) => void;
  switchRoadmap: (slug: string) => void;
}

interface PublicRoadmapMeta {
  organizationId: string;
}

const PublicRoadmapContext = createContext<{
  actions: PublicRoadmapActions;
  meta: PublicRoadmapMeta;
  state: PublicRoadmapState;
} | null>(null);

function usePublicRoadmap() {
  const ctx = use(PublicRoadmapContext);
  if (!ctx) throw new Error("Must be used within PublicRoadmapProvider");
  return ctx;
}

function PublicRoadmapProvider({
  children,
  slug,
}: {
  children: React.ReactNode;
  slug?: string;
}) {
  const site = useSite();
  const navigate = useNavigate();
  const {
    publicBoardCollection,
    publicPostCollection,
    publicPostStatusCollection,
    publicRoadmapCollection,
    publicRoadmapColumnCollection,
  } = usePublicCollections();

  const { allRoadmaps, isError, isLoading, lanesFor, roadmaps } =
    useRoadmapData({
      boardCollection: publicBoardCollection,
      postCollection: publicPostCollection,
      postStatusCollection: publicPostStatusCollection,
      roadmapCollection: publicRoadmapCollection,
      roadmapColumnCollection: publicRoadmapColumnCollection,
      organizationId: site.organizationId,
      slug,
    });

  const displayedRoadmap = roadmaps[0] ?? null;
  const lanes = useMemo(
    () => (displayedRoadmap ? lanesFor(displayedRoadmap.id) : []),
    [displayedRoadmap, lanesFor],
  );
  const primarySlug = allRoadmaps[0]?.slug;

  const openPost = useCallback(
    (postSlug: string) => navigate({ to: `/p/${postSlug}` }),
    [navigate],
  );

  const switchRoadmap = useCallback(
    (nextSlug: string) => {
      if (nextSlug === primarySlug) {
        navigate({ to: "/roadmap", replace: true });
      } else {
        navigate({
          params: { slug: nextSlug },
          replace: true,
          to: "/roadmap/$slug",
        });
      }
    },
    [primarySlug, navigate],
  );

  const value = useMemo(
    () => ({
      actions: { openPost, switchRoadmap },
      meta: { organizationId: site.organizationId },
      state: { allRoadmaps, displayedRoadmap, isError, isLoading, lanes },
    }),
    [
      openPost,
      switchRoadmap,
      site.organizationId,
      allRoadmaps,
      displayedRoadmap,
      isError,
      isLoading,
      lanes,
    ],
  );

  return (
    <PublicRoadmapContext.Provider value={value}>
      {children}
    </PublicRoadmapContext.Provider>
  );
}

// --- Explicit variants — no boolean prop proliferation ---

function PublicRoadmapError({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <Roadmap.Container>
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </Roadmap.Container>
  );
}

function PublicRoadmapBoardContent() {
  const {
    actions: { openPost, switchRoadmap },
    state: { allRoadmaps, displayedRoadmap, lanes },
  } = usePublicRoadmap();

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
            </Roadmap.HeaderActions>
          </Roadmap.Header>

          {lanes.length > 0 ? (
            <RoadmapGrid
              emptyLaneMessage="No updates in this stage."
              lanes={lanes}
              renderCard={({ post }) => (
                <PublicRoadmapIssueCard
                  boardName={post.boardName}
                  key={post.id}
                  onClick={() => openPost(post.slug)}
                  status={post.status}
                  title={post.title}
                  updatedAt={post.updatedAt}
                />
              )}
            />
          ) : (
            <Roadmap.NoColumnsEmpty />
          )}
        </Roadmap.Section>
      </Roadmap.Container>
    </Roadmap.Provider>
  );
}

// --- Public API — explicit page variants instead of optional slug boolean ---

export function PublicRoadmapPage({ slug }: { slug?: string }) {
  // Back-compat: delegates to explicit variants
  if (slug === undefined) return <PublicRoadmapIndexPage />;
  return <PublicRoadmapDetailPage slug={slug} />;
}

function PublicRoadmapIndexPage() {
  return (
    <PublicRoadmapProvider>
      <PublicRoadmapIndexView />
    </PublicRoadmapProvider>
  );
}

function PublicRoadmapIndexView() {
  const {
    state: { displayedRoadmap, isError, isLoading },
  } = usePublicRoadmap();

  if (isError) {
    return (
      <PublicRoadmapError
        description="There was a problem loading the roadmap."
        title="Roadmap unavailable"
      />
    );
  }
  if (isLoading) return <Roadmap.Skeleton />;
  if (!displayedRoadmap) {
    return (
      <PublicRoadmapError
        description="This workspace does not have a public roadmap yet."
        title="No roadmap yet"
      />
    );
  }
  return <PublicRoadmapBoardContent />;
}

function PublicRoadmapDetailPage({ slug }: { slug: string }) {
  return (
    <PublicRoadmapProvider slug={slug}>
      <PublicRoadmapDetailView />
    </PublicRoadmapProvider>
  );
}

function PublicRoadmapDetailView() {
  const {
    state: { displayedRoadmap, isError, isLoading },
  } = usePublicRoadmap();

  if (isError) {
    return (
      <PublicRoadmapError
        description="There was a problem loading the roadmap."
        title="Roadmap unavailable"
      />
    );
  }
  if (isLoading) return <Roadmap.Skeleton />;
  if (!displayedRoadmap) {
    return (
      <PublicRoadmapError
        description="This roadmap does not exist or has been removed."
        title="Roadmap not found"
      />
    );
  }
  return <PublicRoadmapBoardContent />;
}
