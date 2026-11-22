import { PostCollectionDataProvider } from "@feeblo/post-ui/post-collection";
import { formatPostStatus } from "@feeblo/post-ui/post-status";
import { Card, CardPanel } from "@feeblo/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";

import {
  FeedbackCardSkeleton,
  PostCard,
} from "../../components/feedback/feedback-card";
import { m } from "../../paraglide/messages.js";
import { HomeBoardSelect } from "./components/board-select";
import { HomeGiveFeedbackButton } from "./components/give-feedback-button";
import { HomeSearchInput } from "./components/search-input";
import { HomeSortMenu } from "./components/sort-menu";
import { HomeSortSelect } from "./components/sort-select";
import { HomeStatusMenu } from "./components/status-menu";
import {
  HomeBoardFilters,
  HomeLayout,
  HomePage,
  HomeStatusFilters,
  HomeTitle,
  HomeToolbar,
  surfaceClassName,
} from "./home-chrome";
import { useHome } from "./home-context";
import { HomeProvider } from "./home-provider";

function HomeList() {
  const { state, meta } = useHome();
  const { filteredPosts, normalizedSearch } = state;

  return (
    <Card className={surfaceClassName("overflow-hidden")} id="feedback-list">
      <CardPanel className="px-0 py-0">
        {filteredPosts.length === 0 ? (
          <div className="p-5">
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {normalizedSearch ? m.salty_salty_coyote() : m.fair_mad_fox()}
                </EmptyTitle>
                <EmptyDescription>
                  {normalizedSearch
                    ? m.yummy_mellow_quail()
                    : m.fine_basic_parrot()}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <div className="divide-border/40 divide-y">
            {filteredPosts.map(({ board, post, status }) => (
              <PostCollectionDataProvider
                board={board}
                key={post.id}
                organizationId={meta.organizationId}
                pageType="PublicPage"
                post={post}
              >
                {/* Reuses feedback-page PostCard composably — checkbox omitted via composition, no boolean prop */}
                {/* Long feeds render every card: skip off-screen rows' rendering (see dashboard `BoardPostRowItem`). */}
                <PostCard.Root className="[contain-intrinsic-size:auto_72px] [content-visibility:auto]">
                  <PostCard.Link />
                  <PostCard.Upvote />
                  <PostCard.Body>
                    <PostCard.Title />
                    <PostCard.Description />
                    <PostCard.MobileMeta />
                  </PostCard.Body>
                  <PostCard.DesktopMeta>
                    <PostCard.Status
                      color={status.color ?? undefined}
                      icon={status.icon}
                      label={status.label || formatPostStatus(status.type)}
                      type={status.type}
                    />
                    <PostCard.BoardBadge />
                    <PostCard.Author />
                  </PostCard.DesktopMeta>
                </PostCard.Root>
              </PostCollectionDataProvider>
            ))}
          </div>
        )}
      </CardPanel>
    </Card>
  );
}

function HomeLoading() {
  return (
    <HomeLayout>
      <div className="space-y-6">
        <Card className={surfaceClassName("bg-muted/20")}>
          <CardPanel className="px-6 py-8 sm:px-8 sm:py-10">
            <div className="grid gap-6 lg:grid-cols-5 lg:items-center">
              <div className="space-y-3 lg:col-span-3">
                <div className="bg-muted h-3 w-28 animate-pulse rounded-full" />
                <div className="bg-muted h-10 w-3/4 animate-pulse rounded-2xl" />
                <div className="bg-muted h-4 w-2/3 animate-pulse rounded-full" />
              </div>
              <div className="grid gap-3 sm:grid-cols-3 lg:col-span-2 lg:grid-cols-1 xl:grid-cols-3">
                {["a", "b", "c"].map((key) => (
                  <div
                    className="border-border/60 bg-background h-24 animate-pulse rounded-2xl border"
                    key={key}
                  />
                ))}
              </div>
            </div>
          </CardPanel>
        </Card>

        <div className="grid gap-6 lg:grid-cols-4">
          <Card className={surfaceClassName()}>
            <CardPanel className="px-4 py-4">
              <div className="bg-muted h-40 animate-pulse rounded-2xl" />
            </CardPanel>
          </Card>
          <Card className={surfaceClassName("lg:col-span-3")}>
            <CardPanel className="px-0 py-0">
              {["a", "b", "c", "d", "e"].map((key) => (
                <FeedbackCardSkeleton key={key} />
              ))}
            </CardPanel>
          </Card>
        </div>
      </div>
    </HomeLayout>
  );
}

function HomeError() {
  return (
    <HomeLayout>
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>{m.mean_flaky_guppy()}</EmptyTitle>
          <EmptyDescription>{m.day_just_bobcat()}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </HomeLayout>
  );
}

function HomeContent() {
  return (
    <HomePage>
      <HomeList />
    </HomePage>
  );
}

function HomeRoot() {
  const { state } = useHome();

  if (state.isLoading) {
    return <HomeLoading />;
  }

  if (state.isError) {
    return <HomeError />;
  }

  return <HomeContent />;
}

export const Home = {
  BoardFilters: HomeBoardFilters,
  BoardSelect: HomeBoardSelect,
  GiveFeedback: HomeGiveFeedbackButton,
  List: HomeList,
  Provider: HomeProvider,
  Root: HomeRoot,
  Search: HomeSearchInput,
  SortMenu: HomeSortMenu,
  SortSelect: HomeSortSelect,
  StatusFilters: HomeStatusFilters,
  StatusMenu: HomeStatusMenu,
  Title: HomeTitle,
  Toolbar: HomeToolbar,
};
