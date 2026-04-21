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
  ChangelogEditorMetadata,
  ChangelogEditorProvider,
  ChangelogEditorSidebarActionsSection,
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
        <ChangelogEditor>
          <ChangelogEditor.Main>
            <ChangelogEditor.Header>
              <ChangelogEditor.HeaderContent>
                <ChangelogEditorBackLink />
                <ChangelogEditorTitleField />
              </ChangelogEditor.HeaderContent>
              <ChangelogEditorSubmitAction />
            </ChangelogEditor.Header>
            <ChangelogEditorContentField />
          </ChangelogEditor.Main>

          <ChangelogEditor.Sidebar>
            <ChangelogEditor.SidebarSection>
              <p className="text-muted-foreground text-xs uppercase tracking-[0.2em]">
                Status
              </p>
              <ChangelogEditorStatus />
            </ChangelogEditor.SidebarSection>

            <ChangelogEditor.SidebarSeparator />

            <ChangelogEditor.MetadataList>
              <ChangelogEditorMetadata />
            </ChangelogEditor.MetadataList>

            <ChangelogEditorSidebarActionsSection />
          </ChangelogEditor.Sidebar>
        </ChangelogEditor>
      </ChangelogEditorForm>
    </ChangelogEditorProvider>
  );
}

function ChangelogEditorLoadingState() {
  return (
    <SkeletonLoader isLoading>
      <ChangelogEditor>
        <ChangelogEditor.Main>
          <ChangelogEditor.Header>
            <ChangelogEditor.HeaderContent>
              <SkeletonWrapper>
                <div className="h-4 w-28 rounded-md" />
              </SkeletonWrapper>
              <SkeletonWrapper>
                <div className="h-10 w-3/5 rounded-md" />
              </SkeletonWrapper>
            </ChangelogEditor.HeaderContent>

            <SkeletonWrapper>
              <Button type="button">Save</Button>
            </SkeletonWrapper>
          </ChangelogEditor.Header>

          <SkeletonWrapper>
            <div className="h-72 w-full rounded-2xl border bg-background" />
          </SkeletonWrapper>
        </ChangelogEditor.Main>

        <ChangelogEditor.Sidebar>
          <ChangelogEditor.SidebarSection>
            <p className="text-muted-foreground text-xs uppercase tracking-[0.2em]">
              <SkeletonWrapper>Status</SkeletonWrapper>
            </p>
            <SkeletonWrapper>
              <div className="h-6 w-24 rounded-full" />
            </SkeletonWrapper>
          </ChangelogEditor.SidebarSection>

          <ChangelogEditor.SidebarSeparator />

          <ChangelogEditor.MetadataList>
            <ChangelogEditor.MetadataRow
              label="Slug"
              value={<LoadingLine className="w-32" />}
            />
            <ChangelogEditor.MetadataRow
              label="Author"
              value={<LoadingLine className="w-28" />}
            />
            <ChangelogEditor.MetadataRow
              label="Publish At"
              value={<LoadingLine className="w-36" />}
            />
            <ChangelogEditor.MetadataRow
              label="Created"
              value={<LoadingLine className="w-24" />}
            />
            <ChangelogEditor.MetadataRow
              label="Updated"
              value={<LoadingLine className="w-24" />}
            />
          </ChangelogEditor.MetadataList>

          <ChangelogEditor.SidebarSeparator />

          <SkeletonWrapper>
            <Button className="w-full" type="button" variant="outline">
              Move to draft
            </Button>
          </SkeletonWrapper>
          <SkeletonWrapper>
            <Button className="w-full" type="button" variant="destructive">
              Delete changelog
            </Button>
          </SkeletonWrapper>
        </ChangelogEditor.Sidebar>
      </ChangelogEditor>
    </SkeletonLoader>
  );
}

function LoadingLine({ className }: { className: string }) {
  return (
    <SkeletonWrapper>
      <div className={`h-4 rounded-md ${className}`} />
    </SkeletonWrapper>
  );
}
