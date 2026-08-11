import { RoadmapGrid } from "@feeblo/post-ui/roadmap/roadmap-grid";
import { PublicRoadmapIssueCard } from "@feeblo/post-ui/roadmap/roadmap-issue-card";
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
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import { useNavigate } from "@tanstack/react-router";
import { usePublicCollections } from "../../providers/public-collections-provider";
import { useSite } from "../../providers/site-provider";

/**
 * Public roadmap page shared by `/roadmap` (primary roadmap) and
 * `/roadmap/$slug` (any roadmap). Owns the roadmap data query and the
 * loading / error / empty states so routes stay thin.
 */
export function PublicRoadmapPage({ slug }: { slug?: string }) {
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

  if (isError) {
    return (
      <PublicRoadmapMessage
        description="There was a problem loading the roadmap."
        title="Roadmap unavailable"
      />
    );
  }

  if (isLoading) {
    return <PublicRoadmapSkeleton />;
  }

  const displayedRoadmap = roadmaps[0];

  if (!displayedRoadmap) {
    return (
      <PublicRoadmapMessage
        description={
          slug
            ? "This roadmap does not exist or has been removed."
            : "This workspace does not have a public roadmap yet."
        }
        title={slug ? "Roadmap not found" : "No roadmap yet"}
      />
    );
  }

  const primarySlug = allRoadmaps[0]?.slug;

  return (
    <PublicRoadmapBoard
      description={displayedRoadmap.description}
      lanes={lanesFor(displayedRoadmap.id)}
      onOpenPost={(postSlug) => navigate({ to: `/p/${postSlug}` })}
      onSelectRoadmap={(nextSlug) => {
        if (nextSlug === primarySlug) {
          navigate({ to: "/roadmap", replace: true });
        } else {
          navigate({
            to: "/roadmap/$slug",
            params: { slug: nextSlug },
            replace: true,
          });
        }
      }}
      roadmapOptions={allRoadmaps}
      title={displayedRoadmap.name}
      value={displayedRoadmap.slug}
    />
  );
}

function PublicRoadmapBoard({
  description,
  emptyLaneMessage = "No updates in this stage.",
  lanes,
  onOpenPost,
  onSelectRoadmap,
  roadmapOptions,
  title,
  value,
}: {
  description: string | null | undefined;
  emptyLaneMessage?: string;
  lanes: RoadmapLane<RoadmapBoardPost>[];
  onOpenPost: (postSlug: string) => void;
  onSelectRoadmap: (slug: string) => void;
  roadmapOptions: RoadmapSummary[];
  title: string;
  value: string;
}) {
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <section className="flex h-full min-h-0 shrink-0 flex-col gap-4">
        <header className="flex items-start justify-between gap-2 px-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-semibold text-xl">{title}</h1>
            {description ? (
              <p className="mt-1 text-muted-foreground text-sm">
                {description}
              </p>
            ) : null}
          </div>
          <Select
            onValueChange={(nextSlug) => {
              if (nextSlug !== null && nextSlug !== value) {
                onSelectRoadmap(nextSlug);
              }
            }}
            value={value}
          >
            <SelectTrigger className="w-44 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {roadmapOptions.map((roadmap) => (
                <SelectItem key={roadmap.id} value={roadmap.slug}>
                  {roadmap.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </header>
        {lanes.length > 0 ? (
          <RoadmapGrid
            emptyLaneMessage={emptyLaneMessage}
            lanes={lanes}
            renderCard={({ post }) => (
              <PublicRoadmapIssueCard
                boardName={post.boardName}
                key={post.id}
                onClick={() => onOpenPost(post.slug)}
                status={post.status}
                title={post.title}
                updatedAt={post.updatedAt}
              />
            )}
          />
        ) : (
          <div className="flex min-h-64 flex-1 items-center justify-center rounded-lg border border-border/70 border-dashed bg-muted/20 p-6 text-center text-muted-foreground text-sm">
            This roadmap has no columns configured.
          </div>
        )}
      </section>
    </div>
  );
}

function PublicRoadmapMessage({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

function PublicRoadmapSkeleton() {
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col overflow-hidden p-4 md:p-6">
      <div className="grid min-w-max auto-cols-max grid-flow-col gap-4 overflow-x-auto p-3">
        {["planned", "in-progress", "completed"].map((key) => (
          <div className="h-96 w-80 rounded-lg bg-muted/30" key={key} />
        ))}
      </div>
    </div>
  );
}
