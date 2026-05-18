import { eq, useLiveQuery } from "@tanstack/react-db";
import { Link } from "wouter";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { Separator } from "@feeblo/ui/separator";
import {
  ChangelogPageLayout,
  ChangelogTimeline,
  ChangelogTimelineBody,
  ChangelogTimelineDate,
  ChangelogTimelineItem,
  formatChangelogDate,
} from "../components/changelog/changelog-layout";
import { usePublicCollections } from "../providers/public-collections-provider";
import { useSite } from "../providers/site-provider";

export function ChangelogPage() {
  const site = useSite();
  const { publicChangelogCollection } = usePublicCollections();
  const {
    data: changelogs = [],
    isLoading,
    isError,
  } = useLiveQuery(
    (q) =>
      q
        .from({ changelog: publicChangelogCollection })
        .where(({ changelog }) =>
          eq(changelog.organizationId, site.organizationId)
        )
        .orderBy(({ changelog }) => changelog.publishedAt, "desc"),
    [site.organizationId]
  );

  if (isLoading) {
    return <ChangelogPageLayout>Loading changelog...</ChangelogPageLayout>;
  }

  if (isError) {
    return (
      <ChangelogPageLayout>
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Changelog unavailable</EmptyTitle>
            <EmptyDescription>
              There was a problem loading published changelog entries.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </ChangelogPageLayout>
    );
  }

  return (
    <ChangelogPageLayout>
      <h2 className="pb-3 font-semibold text-base tracking-tight">
        Changelogs
      </h2>
      {changelogs.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No published changelogs yet</EmptyTitle>
            <EmptyDescription>
              Published changelog updates will appear here once they are
              released.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="pt-6 pb-8">
            <Separator />
          </div>

          <ChangelogTimeline>
            {changelogs.map((item) => (
              <ChangelogTimelineItem className="pb-14 md:pb-16" key={item.id}>
                <ChangelogTimelineDate>
                    <time className="font-medium text-muted-foreground text-sm tracking-tight">
                      {formatChangelogDate(item.publishedAt ?? item.createdAt)}
                    </time>
                </ChangelogTimelineDate>

                <ChangelogTimelineBody className="space-y-6 p-0 sm:p-0">
                  <header>
                    <Link
                      className="block w-fit transition-opacity hover:opacity-80"
                      href={`/changelog/${item.slug}`}
                    >
                      <h3 className="font-semibold text-2xl tracking-tight sm:text-3xl">
                        {item.title}
                      </h3>
                    </Link>
                  </header>

                  <div
                    className="typography"
                    dangerouslySetInnerHTML={{ __html: item.content }}
                  />
                </ChangelogTimelineBody>
              </ChangelogTimelineItem>
            ))}
          </ChangelogTimeline>
        </>
      )}
    </ChangelogPageLayout>
  );
}
