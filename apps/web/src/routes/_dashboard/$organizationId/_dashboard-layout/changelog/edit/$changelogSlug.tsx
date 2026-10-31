import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { SkeletonLoader, SkeletonWrapper } from "@feeblo/ui/skeleton-loader";
import { isLiveQueryFailed } from "@feeblo/web-shared/collections";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { ChangelogCompletedPosts } from "~/features/changelog/components/changelog-completed-posts";
import {
  ChangelogEditorBackLink,
  ChangelogEditorCategoryField,
  ChangelogEditorContentField,
  ChangelogEditorCoverImageField,
  ChangelogEditorDetails,
  ChangelogEditorForm,
  ChangelogEditorProvider,
  ChangelogEditorSidebarActions,
  ChangelogEditorSubmitAction,
  ChangelogEditorTitleField,
} from "~/features/changelog/components/changelog-editor";
import {
  ChangelogDeleteDialog,
  ChangelogMoveToDraftDialog,
} from "~/features/changelog/components/changelog-editor-alert-dialogs";
import { ChangelogEditor } from "~/features/changelog/components/changelog-editor-layout";
import {
  ChangelogDeleteDialogProvider,
  ChangelogMoveToDraftDialogProvider,
} from "~/features/changelog/dialog-stores";
import { preloadChangelogEditor } from "~/lib/preloads";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

export const Route = createFileRoute(
  "/_dashboard/$organizationId/_dashboard-layout/changelog/edit/$changelogSlug"
)({
  beforeLoad: async () => {
    await preloadChangelogEditor();
  },
  component: RouteComponent,
});

/** The changelog a URL slug last resolved to, so a rename can follow the row. */
type SlugResolution = { forSlug: string; id: string };

function RouteComponent() {
  const { organizationId, changelogSlug } = Route.useParams();
  const { changelogCollection } = useDashboardCollections();

  // The row is matched in this component rather than by the query, because a
  // rename moves it away from the slug that is still in the URL: a query
  // filtered by that slug cannot hand back the row that just left it. Keying on
  // the workspace instead also keeps the query stable across the navigation to
  // the new slug. The collection is already scoped to the signed-in workspace,
  // so reading it whole is not a wider read, and `(organizationId, slug)` is
  // unique in the database, so the match below cannot be ambiguous.
  const changelogsQuery = useLiveQuery({
    queryKey: ["changelog-editor", changelogCollection.id, organizationId],
    query: (q) =>
      q
        .from({ changelog: changelogCollection })
        .where(({ changelog }) => eq(changelog.organizationId, organizationId)),
  });
  const changelogs = changelogsQuery.data ?? [];
  const matched = changelogs.find((row) => row.slug === changelogSlug);

  // A save writes the new slug into the collection before the editor navigates
  // to it, and it waits out the whole round trip in between. For that long the
  // row answers to the new slug while the URL still names the old one, nothing
  // matches, and the page used to render "Changelog not found" — tearing down
  // the editor and remounting it once the URL caught up. Keep the row the URL
  // resolved to so a rename this page started stays on screen. The allowance is
  // tied to the slug it was resolved under, so it expires as soon as the URL
  // names another slug and a genuinely missing entry still says so.
  //
  // Adjusted during render rather than in an effect: React supports state
  // derived from props this way, and a render it discards takes the adjustment
  // with it, which a ref written during render would not. It cannot loop —
  // `(organizationId, slug)` is unique, so once recorded the same slug keeps
  // resolving to the same row and the condition goes false.
  const [resolved, setResolved] = useState<SlugResolution | null>(null);
  if (matched !== undefined && resolved?.forSlug !== changelogSlug) {
    setResolved({ forSlug: changelogSlug, id: matched.id });
  }
  const renamedRow =
    matched === undefined && resolved?.forSlug === changelogSlug
      ? changelogs.find((row) => row.id === resolved.id)
      : undefined;
  const changelog = matched ?? renamedRow;

  if (changelogsQuery.isLoading) {
    return <ChangelogEditorLoadingState />;
  }

  if (isLiveQueryFailed(changelogsQuery)) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Changelog unavailable</EmptyTitle>
          <EmptyDescription>
            There was a problem loading this changelog entry.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (!changelog) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Changelog not found</EmptyTitle>
          <EmptyDescription>
            We could not find the changelog entry you requested.
          </EmptyDescription>
          <EmptyContent>
            <Button
              render={(props) => (
                <Link
                  {...props}
                  params={{ organizationId }}
                  to="/$organizationId/changelog"
                >
                  Back to changelog
                </Link>
              )}
              variant="link"
            />
          </EmptyContent>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    // Keyed by row, not by slug: the provider seeds the form from the row and
    // mints the asset-upload scope, so a different changelog must get a fresh
    // one. A rename to the same row (the publish path above) must not.
    <ChangelogEditorProvider
      changelog={changelog}
      key={changelog.id}
      organizationId={organizationId}
    >
      <ChangelogMoveToDraftDialogProvider>
        <ChangelogDeleteDialogProvider>
          <ChangelogEditorForm>
            <ChangelogEditor>
              <ChangelogEditor.Main>
                <ChangelogEditor.Header className="items-center gap-3">
                  <ChangelogEditorBackLink />
                </ChangelogEditor.Header>

                <ChangelogEditorCoverImageField />
                <ChangelogEditorTitleField />
                <ChangelogEditorContentField />
                <ChangelogCompletedPosts organizationId={organizationId} />
                <div className="flex justify-end pt-2">
                  <ChangelogEditorSubmitAction />
                </div>
              </ChangelogEditor.Main>
              <ChangelogEditor.Sidebar>
                <ChangelogEditorSidebarActions />
                <ChangelogEditorCategoryField />
                <ChangelogEditor.SidebarSeparator />
                <ChangelogEditorDetails />
              </ChangelogEditor.Sidebar>
            </ChangelogEditor>
          </ChangelogEditorForm>
          <ChangelogMoveToDraftDialog />
          <ChangelogDeleteDialog />
        </ChangelogDeleteDialogProvider>
      </ChangelogMoveToDraftDialogProvider>
    </ChangelogEditorProvider>
  );
}

function ChangelogEditorLoadingState() {
  return (
    <SkeletonLoader isLoading>
      <ChangelogEditor>
        <ChangelogEditor.Main>
          <ChangelogEditor.Header className="items-center gap-3">
            <SkeletonWrapper>
              <div className="bg-background size-8 rounded-full border" />
            </SkeletonWrapper>
          </ChangelogEditor.Header>

          <SkeletonWrapper>
            <div className="h-10 w-3/5 rounded-md" />
          </SkeletonWrapper>

          <SkeletonWrapper>
            <div className="bg-background h-72 w-full rounded-2xl border" />
          </SkeletonWrapper>

          <div className="flex justify-end pt-2">
            <SkeletonWrapper>
              <Button type="button">Save</Button>
            </SkeletonWrapper>
          </div>
        </ChangelogEditor.Main>
        <ChangelogEditor.Sidebar>
          <div className="flex items-center justify-end gap-2">
            <SkeletonWrapper>
              <div className="bg-background size-8 rounded-full border" />
            </SkeletonWrapper>
            <SkeletonWrapper>
              <div className="bg-background size-8 rounded-full border" />
            </SkeletonWrapper>
            <SkeletonWrapper>
              <div className="bg-background size-8 rounded-full border" />
            </SkeletonWrapper>
          </div>
          <SkeletonWrapper>
            <div className="h-8 w-full rounded-md" />
          </SkeletonWrapper>
          <SkeletonWrapper>
            <div className="h-24 w-full rounded-md" />
          </SkeletonWrapper>
          <SkeletonWrapper>
            <div className="h-6 w-20 rounded-full" />
          </SkeletonWrapper>
        </ChangelogEditor.Sidebar>
      </ChangelogEditor>
    </SkeletonLoader>
  );
}
