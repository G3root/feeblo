import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  SkeletonLoader,
  SkeletonWrapper,
} from "~/components/ui/skeleton-loader";
import {
  ChangelogEditorBackLink,
  ChangelogEditorContentField,
  ChangelogEditorForm,
  ChangelogEditorMoreActions,
  ChangelogEditorProvider,
  ChangelogEditorStatus,
  ChangelogEditorSubmitAction,
  ChangelogEditorTitleField,
} from "~/features/changelog/components/changelog-editor";
import { ChangelogEditor } from "~/features/changelog/components/changelog-editor-layout";
import { changelogCollection } from "~/lib/collections";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/changelog/edit/$changelogSlug"
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { organizationId, changelogSlug } = Route.useParams();

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
              nativeButton={false}
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
      <ChangelogEditorForm>
        <ChangelogEditor className="max-w-6xl">
          <ChangelogEditor.Main className="space-y-6 px-4 py-4 sm:px-6 sm:py-6">
            <ChangelogEditor.Header className="items-center gap-3">
              <ChangelogEditorBackLink />
              <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                <ChangelogEditorStatus />
                <ChangelogEditorMoreActions />
              </div>
            </ChangelogEditor.Header>

            <ChangelogEditorTitleField />
            <ChangelogEditorContentField />
            <div className="flex justify-end pt-2">
              <ChangelogEditorSubmitAction />
            </div>
          </ChangelogEditor.Main>
        </ChangelogEditor>
      </ChangelogEditorForm>
    </ChangelogEditorProvider>
  );
}

function ChangelogEditorLoadingState() {
  return (
    <SkeletonLoader isLoading>
      <ChangelogEditor className="max-w-6xl">
        <ChangelogEditor.Main className="space-y-6 px-4 py-4 sm:px-6 sm:py-6">
          <ChangelogEditor.Header className="items-center gap-3">
            <SkeletonWrapper>
              <div className="size-8 rounded-full border bg-background" />
            </SkeletonWrapper>
            <div className="flex flex-1 items-center justify-end gap-2">
              <SkeletonWrapper>
                <div className="h-6 w-24 rounded-full" />
              </SkeletonWrapper>
              <SkeletonWrapper>
                <div className="size-8 rounded-full border bg-background" />
              </SkeletonWrapper>
            </div>
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
      </ChangelogEditor>
    </SkeletonLoader>
  );
}
