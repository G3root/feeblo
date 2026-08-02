import { RoadmapGrid } from "@feeblo/post-ui/roadmap/roadmap-grid";
import { PublicRoadmapIssueCard } from "@feeblo/post-ui/roadmap/roadmap-issue-card";
import { useRoadmapData } from "@feeblo/post-ui/roadmap/use-roadmap-data";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import {
  createLazyRoute,
  getRouteApi,
  useNavigate,
} from "@tanstack/react-router";
import { usePublicCollections } from "../providers/public-collections-provider";
import { useSite } from "../providers/site-provider";

const roadmapSlugRouteApi = getRouteApi("/roadmap/$slug");

export const Route = createLazyRoute("/roadmap/$slug")({
  component: RoadmapSlugPage,
});

function RoadmapSlugPage() {
  const site = useSite();
  const navigate = useNavigate();
  const { slug } = roadmapSlugRouteApi.useParams();
  const {
    publicBoardCollection,
    publicPostCollection,
    publicPostStatusCollection,
    publicRoadmapCollection,
    publicRoadmapColumnCollection,
  } = usePublicCollections();

  const { isError, isLoading, lanesFor, roadmaps } = useRoadmapData({
    boardCollection: publicBoardCollection,
    postCollection: publicPostCollection,
    postStatusCollection: publicPostStatusCollection,
    roadmapCollection: publicRoadmapCollection,
    roadmapColumnCollection: publicRoadmapColumnCollection,
    organizationId: site.organizationId,
  });

  if (isError) {
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
        <div className="flex min-h-64 flex-1 items-center justify-center rounded-lg border border-border/70 border-dashed bg-muted/20 p-6 text-center text-muted-foreground text-sm">
          There was a problem loading the roadmap.
        </div>
      </div>
    );
  }

  if (isLoading) {
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

  const primaryRoadmap = roadmaps[0];
  const selectedRoadmap = roadmaps.find((r) => r.slug === slug);

  if (!selectedRoadmap) {
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
        <div className="flex min-h-64 flex-1 items-center justify-center rounded-lg border border-border/70 border-dashed bg-muted/20 p-6 text-center text-muted-foreground text-sm">
          This roadmap does not exist or has been removed.
        </div>
      </div>
    );
  }

  const lanes = lanesFor(selectedRoadmap.id);

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <section className="flex h-full min-h-0 shrink-0 flex-col gap-4">
        <header className="flex items-start justify-between gap-2 px-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-semibold text-xl">{selectedRoadmap.name}</h1>
            {selectedRoadmap.description ? (
              <p className="mt-1 text-muted-foreground text-sm">
                {selectedRoadmap.description}
              </p>
            ) : null}
          </div>
          <Select
            onValueChange={(newSlug) => {
              if (newSlug === null) {
                return;
              }
              if (primaryRoadmap && newSlug === primaryRoadmap.slug) {
                navigate({
                  to: "/roadmap",
                  replace: true,
                });
              } else {
                navigate({
                  to: "/roadmap/$slug",
                  params: { slug: newSlug },
                  replace: true,
                });
              }
            }}
            value={selectedRoadmap.slug}
          >
            <SelectTrigger className="w-44 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {roadmaps.map((roadmap) => (
                <SelectItem key={roadmap.id} value={roadmap.slug}>
                  {roadmap.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </header>
        {lanes.length > 0 ? (
          <RoadmapGrid
            emptyLaneMessage="No updates in this stage."
            lanes={lanes}
            renderCard={({ post }) => (
              <PublicRoadmapIssueCard
                boardName={post.boardName}
                key={post.id}
                onClick={() => navigate({ to: `/p/${post.slug}` })}
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
