import { Card, CardPanel, CardTitle } from "@feeblo/ui/card";
import { cn } from "@feeblo/ui/utils";
import type { ReactNode } from "react";

import {
  FeedbackBrowseLayout,
  FeedbackBrowseLayoutContent,
  FeedbackBrowseLayoutMain,
} from "../../components/layout/feedback-browse-layout";
import { m } from "../../paraglide/messages.js";
import { HomeBoardSelect } from "./components/board-select";
import { HomeFilterList } from "./components/filter-list";
import { HomeGiveFeedbackButton } from "./components/give-feedback-button";
import { HomeSearchInput } from "./components/search-input";
import { HomeSortMenu } from "./components/sort-menu";
import { HomeSortSelect } from "./components/sort-select";
import { HomeStatusMenu } from "./components/status-menu";
import { useHome } from "./home-context";

/**
 * The home page's frame, title, toolbar and filters.
 *
 * Split from the feed because two surfaces draw this page: the live home, whose
 * list reads the board's collections, and the register preview, whose list is a
 * static picture of the workspace about to be created. Sharing the chrome is
 * what keeps the preview from drifting into an approximation of the page — it
 * is the page, with a different feed and no data behind it.
 */

export function surfaceClassName(className?: string) {
  return cn(
    "border-border/60 bg-background rounded-3xl border py-0 shadow-none",
    className
  );
}

export function HomeLayout({ children }: { children: ReactNode }) {
  return (
    <FeedbackBrowseLayout>
      <FeedbackBrowseLayoutContent fullWidth>
        <FeedbackBrowseLayoutMain>{children}</FeedbackBrowseLayoutMain>
      </FeedbackBrowseLayoutContent>
    </FeedbackBrowseLayout>
  );
}

export function HomeTitle() {
  const { state } = useHome();

  return (
    <CardTitle className="hidden px-1 text-xl leading-tight sm:block">
      {state.selectedBoard === "all"
        ? m.muddy_bad_midge()
        : state.activeBoardLabel}
    </CardTitle>
  );
}

export function HomeToolbar() {
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

export function HomeStatusFilters() {
  const { state, actions } = useHome();

  return (
    <HomeFilterList
      items={state.statusItems}
      onSelect={(value) => actions.updateFilters({ status: value })}
      selectedValue={state.selectedStatus}
      title={m.orange_ornate_spider()}
    />
  );
}

export function HomeBoardFilters() {
  const { state, actions } = useHome();

  return (
    <HomeFilterList
      items={state.boardItems}
      onSelect={(value) => actions.updateFilters({ board: value })}
      selectedValue={state.selectedBoard}
      title={m.weary_gray_oryx()}
    />
  );
}

export function HomeSidebar() {
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

/** The live page's arrangement: the feed on the left, the filters beside it. */
export function HomePage({ children }: { children: ReactNode }) {
  return (
    <HomeLayout>
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-3">
            <HomeTitle />
            <HomeToolbar />
            {children}
          </div>
          <HomeSidebar />
        </div>
      </div>
    </HomeLayout>
  );
}
