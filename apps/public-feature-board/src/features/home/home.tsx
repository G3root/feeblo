import { PostCollectionDataProvider } from "@feeblo/post-ui/post-collection";
import { Card, CardPanel, CardTitle } from "@feeblo/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { cn } from "@feeblo/ui/utils";
import type { ReactNode } from "react";

import {
  FeedbackCardSkeleton,
  PostCard,
} from "../../components/feedback/feedback-card";
import {
  FeedbackBrowseLayout,
  FeedbackBrowseLayoutContent,
  FeedbackBrowseLayoutMain,
} from "../../components/layout/feedback-browse-layout";
import { HomeBoardSelect } from "./components/board-select";
import { HomeFilterList } from "./components/filter-list";
import { HomeGiveFeedbackButton } from "./components/give-feedback-button";
import { HomeSearchInput } from "./components/search-input";
import { HomeSortMenu } from "./components/sort-menu";
import { HomeSortSelect } from "./components/sort-select";
import { HomeStatusMenu } from "./components/status-menu";
import { useHome } from "./home-context";
import { HomeProvider } from "./home-provider";

function surfaceClassName(className?: string) {
  return cn(
    "border-border/60 bg-background rounded-3xl border py-0 shadow-none",
    className
  );
}

function HomeLayout({ children }: { children: ReactNode }) {
  return (
    <FeedbackBrowseLayout>
      <FeedbackBrowseLayoutContent fullWidth>
        <FeedbackBrowseLayoutMain>{children}</FeedbackBrowseLayoutMain>
      </FeedbackBrowseLayoutContent>
    </FeedbackBrowseLayout>
  );
}

function HomeTitle() {
  const { state } = useHome();

  return (
    <CardTitle className="hidden px-1 sm:block">
      {state.selectedBoard === "all" ? "All feedback" : state.activeBoardLabel}
    </CardTitle>
  );
}

function HomeToolbar() {
  const { state } = useHome();
  const { searchFocused } = state;

  return (
    <div className="flex items-center">
      <div
        aria-hidden={searchFocused || undefined}
        className={cn(
          "grid min-w-0 transition-[grid-template-columns,opacity] duration-300 ease-out",
          searchFocused
            ? "grid-cols-[0fr] opacity-0"
            : "grid-cols-[1fr] opacity-100"
        )}
        inert={searchFocused || undefined}
      >
        <div className="flex min-w-0 items-center gap-2 overflow-hidden pr-2">
          <HomeBoardSelect className="w-32 sm:hidden" />
          <HomeStatusMenu className="sm:hidden" />
          <HomeSortSelect className="hidden w-40 sm:inline-flex" />
          <HomeSortMenu className="sm:hidden" />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        <HomeSearchInput />
        <HomeGiveFeedbackButton />
      </div>
    </div>
  );
}

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
                  {normalizedSearch
                    ? "No feedback matches your search"
                    : "No matching feedback"}
                </EmptyTitle>
                <EmptyDescription>
                  {normalizedSearch
                    ? "Try a different search term."
                    : "Try another status or board to see more public posts."}
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
                <PostCard.Root>
                  <PostCard.Link />
                  <PostCard.Upvote />
                  <PostCard.Body>
                    <PostCard.Title />
                    <PostCard.Description />
                    <PostCard.MobileMeta />
                  </PostCard.Body>
                  <PostCard.DesktopMeta>
                    <PostCard.Status status={status.type} />
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

function HomeStatusFilters() {
  const { state, actions } = useHome();

  return (
    <HomeFilterList
      items={state.statusItems}
      onSelect={(value) => actions.updateFilters({ status: value })}
      selectedValue={state.selectedStatus}
      title="Status"
    />
  );
}

function HomeBoardFilters() {
  const { state, actions } = useHome();

  return (
    <HomeFilterList
      items={state.boardItems}
      onSelect={(value) => actions.updateFilters({ board: value })}
      selectedValue={state.selectedBoard}
      title="Boards"
    />
  );
}

function HomeSidebar() {
  return (
    <div className="hidden flex-col gap-2 lg:flex">
      <Card className={surfaceClassName("h-fit")}>
        <CardPanel className="space-y-6 pt-4 pb-4">
          <HomeStatusFilters />
          <HomeBoardFilters />
        </CardPanel>
      </Card>
    </div>
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
          <EmptyTitle>Feedback unavailable</EmptyTitle>
          <EmptyDescription>
            There was a problem loading feedback.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </HomeLayout>
  );
}

function HomeContent() {
  return (
    <HomeLayout>
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-3">
            <HomeTitle />
            <HomeToolbar />
            <HomeList />
          </div>
          <HomeSidebar />
        </div>
      </div>
    </HomeLayout>
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
