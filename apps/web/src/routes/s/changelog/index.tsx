import {
  preloadBoardChangelog,
  type PreloadOutcome,
} from "@feeblo/public-feature-board";
import { ChangelogPage } from "@feeblo/public-feature-board/pages/changelog";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/s/changelog/")({
  beforeLoad: ({ context }): Promise<PreloadOutcome> =>
    preloadBoardChangelog(context.dbClient),
  component: ChangelogPage,
});
