import { and, eq, useLiveSuspenseQuery } from "@tanstack/react-db";
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
  "/$organizationId/_dashboard-layout/changelog/$changelogSlug"
)({
  component: RouteComponent,
  pendingComponent: ChangelogRoutePending,
});

function RouteComponent() {
  const { organizationId, changelogSlug } = Route.useParams();

  const { data: changelog } = useLiveSuspenseQuery(
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

function ChangelogRoutePending() {
  return <ChangelogEditorSkeleton />;
}
