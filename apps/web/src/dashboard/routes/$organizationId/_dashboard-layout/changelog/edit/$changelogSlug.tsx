import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { SkeletonLoader, SkeletonWrapper } from "@feeblo/ui/skeleton-loader";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, Link } from "@tanstack/react-router";
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
import {
  changelogCategoryCollection,
  changelogCategoryLinkCollection,
  changelogCollection,
  changelogPostCollection,
  postCollection,
  postStatusCollection,
} from "~/lib/collections";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/changelog/edit/$changelogSlug"
)({
  beforeLoad: async () => {
    await Promise.all([
      changelogCollection.preload(),
      changelogPostCollection.preload(),
      postCollection.preload(),
      postStatusCollection.preload(),
      changelogCategoryCollection.preload(),
      changelogCategoryLinkCollection.preload(),
    ]);
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { organizationId, changelogSlug } = Route.useParams();
  const { changelogCollection } = useDashboardCollections();

  const changelogQuery = useLiveQuery(
    (q) =>
      q
        .from({ changelog: changelogCollection })
        .where(({ changelog }) =>
          and(
            eq(changelog.organizationId, organizationId),
            eq(changelog.slug, changelogSlug)
          )
        )
        .findOne(),
    [organizationId, changelogSlug]
  );
  const changelog = changelogQuery.data;

  if (changelogQuery.isLoading) {
    return <ChangelogEditorLoadingState />;
  }

  if (changelogQuery.isError) {
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
    <ChangelogEditorProvider
      changelog={changelog}
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
              <div className="size-8 rounded-full border bg-background" />
            </SkeletonWrapper>
          </ChangelogEditor.Header>

          <SkeletonWrapper>
            <div className="h-10 w-3/5 rounded-md" />
          </SkeletonWrapper>

          <SkeletonWrapper>
            <div className="h-72 w-full rounded-2xl border bg-background" />
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
              <div className="size-8 rounded-full border bg-background" />
            </SkeletonWrapper>
            <SkeletonWrapper>
              <div className="size-8 rounded-full border bg-background" />
            </SkeletonWrapper>
            <SkeletonWrapper>
              <div className="size-8 rounded-full border bg-background" />
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
