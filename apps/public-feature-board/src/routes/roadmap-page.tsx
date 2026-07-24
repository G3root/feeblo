import { RoadmapGrid } from "@feeblo/post-ui/roadmap/roadmap-grid";
import { PublicRoadmapIssueCard } from "@feeblo/post-ui/roadmap/roadmap-issue-card";
import { groupRoadmapPostsByStatus } from "@feeblo/post-ui/roadmap/utils";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { Tabs, TabsList, TabsTab } from "@feeblo/ui/tabs";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import {
  createLazyRoute,
  getRouteApi,
  useNavigate,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  FeedbackBrowseLayout,
  FeedbackBrowseLayoutContent,
  FeedbackBrowseLayoutMain,
} from "../components/layout/feedback-browse-layout";
import { usePublicCollections } from "../providers/public-collections-provider";
import { useSite } from "../providers/site-provider";

const roadmapRouteApi = getRouteApi("/roadmap");

function MainLayout({ children }: { children: ReactNode }) {
  return (
    <FeedbackBrowseLayout>
      <FeedbackBrowseLayoutContent fullWidth>
        <FeedbackBrowseLayoutMain>
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            {children}
          </div>
        </FeedbackBrowseLayoutMain>
      </FeedbackBrowseLayoutContent>
    </FeedbackBrowseLayout>
  );
}

export const Route = createLazyRoute("/roadmap")({
  component: RoadmapPage,
});

function RoadmapPage() {
  const site = useSite();
  const navigate = useNavigate();
  const search = roadmapRouteApi.useSearch();
  const {
    publicBoardCollection,
    publicPostCollection,
    publicPostStatusCollection,
    publicRoadmapCollection,
    publicRoadmapColumnCollection,
  } = usePublicCollections();

  const roadmapsQuery = useLiveQuery(
    (q) => {
      if (!site.organizationId) {
        return undefined;
      }

      return q
        .from({ roadmap: publicRoadmapCollection })
        .where(({ roadmap }) =>
          and(
            eq(roadmap.organizationId, site.organizationId),
            eq(roadmap.mode, "status")
          )
        )
        .select(({ roadmap }) => ({
          description: roadmap.description,
          id: roadmap.id,
          name: roadmap.name,
          slug: roadmap.slug,
        }))
        .orderBy(({ roadmap }) => roadmap.createdAt, "asc");
    },
    [site.organizationId]
  );

  const columnsQuery = useLiveQuery(
    (q) => {
      if (!site.organizationId) {
        return undefined;
      }

      return q
        .from({ column: publicRoadmapColumnCollection })
        .join(
          { postStatus: publicPostStatusCollection },
          ({ column, postStatus }) => eq(column.statusId, postStatus.id),
          "inner"
        )
        .select(({ column, postStatus }) => ({
          id: postStatus.id,
          name: column.name,
          roadmapId: column.roadmapId,
          type: postStatus.type,
        }))
        .orderBy(({ column }) => column.position, "asc");
    },
    [site.organizationId]
  );

  const postsQuery = useLiveQuery(
    (q) => {
      if (!site.organizationId) {
        return undefined;
      }

      return q
        .from({ post: publicPostCollection })
        .join(
          { postStatus: publicPostStatusCollection },
          ({ post, postStatus }) => eq(post.statusId, postStatus.id),
          "inner"
        )
        .join(
          { board: publicBoardCollection },
          ({ post, board }) => eq(post.boardId, board.id),
          "inner"
        )
        .where(({ post }) => eq(post.organizationId, site.organizationId))
        .select(({ board, post, postStatus }) => ({
          boardName: board.name,
          id: post.id,
          slug: post.slug,
          status: postStatus.type,
          statusId: post.statusId,
          summary: post.excerpt,
          title: post.title,
          updatedAt: post.updatedAt,
        }))
        .orderBy(({ post }) => post.createdAt, "desc");
    },
    [site.organizationId]
  );

  if (roadmapsQuery.isError || columnsQuery.isError || postsQuery.isError) {
    return (
      <MainLayout>
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Roadmap unavailable</EmptyTitle>
            <EmptyDescription>
              There was a problem loading the roadmap.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </MainLayout>
    );
  }

  if (
    roadmapsQuery.isLoading ||
    columnsQuery.isLoading ||
    postsQuery.isLoading
  ) {
    return (
      <MainLayout>
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-3">
          <div className="grid h-full min-w-max auto-cols-max grid-flow-col gap-4">
            {["planned", "progress", "completed"].map((key) => (
              <div className="h-full w-80 rounded-lg bg-muted/30" key={key} />
            ))}
          </div>
        </div>
      </MainLayout>
    );
  }

  const roadmaps = roadmapsQuery.data ?? [];
  const firstRoadmap = roadmaps[0];

  if (!firstRoadmap) {
    return (
      <MainLayout>
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No roadmap yet</EmptyTitle>
            <EmptyDescription>
              This workspace does not have a public roadmap yet.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </MainLayout>
    );
  }

  const selectedRoadmap =
    roadmaps.find((roadmap) => roadmap.slug === search.roadmap) ?? firstRoadmap;

  const columns = columnsQuery.data ?? [];
  const posts = postsQuery.data ?? [];
  const lanes = groupRoadmapPostsByStatus(
    posts,
    columns.filter((column) => column.roadmapId === selectedRoadmap.id)
  );

  return (
    <MainLayout>
      {roadmaps.length > 1 ? (
        <div className="px-3 pb-3">
          <Tabs
            onValueChange={(slug) =>
              navigate({
                to: "/roadmap",
                search: { roadmap: slug },
                replace: true,
              })
            }
            value={selectedRoadmap.slug}
          >
            <TabsList>
              {roadmaps.map((roadmap) => (
                <TabsTab key={roadmap.id} value={roadmap.slug}>
                  {roadmap.name}
                </TabsTab>
              ))}
            </TabsList>
          </Tabs>
        </div>
      ) : null}

      <header className="px-3 pb-3">
        <h2 className="font-semibold text-base tracking-tight">
          {selectedRoadmap.name}
        </h2>
        {selectedRoadmap.description ? (
          <p className="mt-1 text-muted-foreground text-sm">
            {selectedRoadmap.description}
          </p>
        ) : null}
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
    </MainLayout>
  );
}
