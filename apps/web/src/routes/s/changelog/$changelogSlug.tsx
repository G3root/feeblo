import {
  preloadBoardChangelog,
  preloadChangelogDetail,
  type PreloadOutcome,
} from "@feeblo/public-feature-board";
import { ChangelogDetailPage } from "@feeblo/public-feature-board/pages/changelog-detail";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/s/changelog/$changelogSlug")({
  // The single-entry body (with its linked posts) replaces a full-list
  // preload: one response instead of up to `PUBLIC_CHANGELOG_LIMIT` bodies.
  beforeLoad: async ({
    context,
    params,
  }): Promise<PreloadOutcome | undefined> => {
    const categories = await preloadBoardChangelog(context.dbClient);

    if (context.boardPage.kind !== "found") {
      return categories;
    }

    const detail = await preloadChangelogDetail(context.dbClient, {
      organizationId: context.boardPage.site.organizationId,
      slug: params.changelogSlug,
    });

    return { degraded: categories.degraded || detail.degraded };
  },
  component: ChangelogDetailRoute,
});

function ChangelogDetailRoute() {
  const { changelogSlug } = Route.useParams();

  return <ChangelogDetailPage changelogSlug={changelogSlug} />;
}
