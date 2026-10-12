import { createAsync } from "@solidjs/router";
import { Show, Suspense } from "solid-js";

import { BoardList } from "../components/board-list/board-list";
import { BoardListSkeleton } from "../components/board-list/board-list-skeleton";
import { ViewTransition } from "../components/shell/view-transition";
import { UpdatesList } from "../components/updates/updates-list";
import { fetchBoards } from "../lib/api";
import { getWidgetConfig } from "../lib/config";

/**
 * The widget's landing route. With feedback enabled it is the feedback
 * surface's root; an updates-only config renders the updates list here so a
 * bare `#/` never dead-ends (the SDK lands such configs on `#/updates`).
 */
export function IndexComponent() {
  const config = getWidgetConfig();

  return (
    <Show fallback={<UpdatesList />} when={config.modules.includes("feedback")}>
      <BoardListRoute />
    </Show>
  );
}

function BoardListRoute() {
  const boards = createAsync(() => fetchBoards());

  return (
    <ViewTransition kind="root">
      <Suspense fallback={<BoardListSkeleton />}>
        <Show keyed when={boards()}>
          {(list) => <BoardList boards={list} />}
        </Show>
      </Suspense>
    </ViewTransition>
  );
}

export default IndexComponent;
