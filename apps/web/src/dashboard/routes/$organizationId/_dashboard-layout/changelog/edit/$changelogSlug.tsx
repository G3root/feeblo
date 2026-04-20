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
  ChangelogEditorScreen,
  ChangelogEditorSkeleton,
} from "~/features/changelog/components/changelog-editor";
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
    return <ChangelogEditorSkeleton />;
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
    <ChangelogEditorScreen
      changelog={changelog}
      organizationId={organizationId}
    />
  );
}
