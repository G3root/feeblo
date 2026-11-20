import { PLAN_ENTITLEMENTS } from "@feeblo/domain/plan-entitlements";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import { ConfirmDialog } from "@feeblo/ui/confirm-dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@feeblo/ui/menu";
import { SkeletonLoader, SkeletonWrapper } from "@feeblo/ui/skeleton-loader";
import { toastManager } from "@feeblo/ui/toast";
import { cn } from "@feeblo/ui/utils";
import { isLiveQueryFailed } from "@feeblo/web-shared/collections";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import {
  ArrowRight02Icon,
  BookOpen01Icon,
  Delete02Icon,
  Edit02Icon,
  Ellipsis,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { usePlan } from "~/hooks/use-plan";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { HelpCenterAnalytics } from "./help-center-analytics";
import { HelpCenterSearch } from "./help-center-search";
import {
  CreateHelpCenterTopicDialog,
  EditHelpCenterTopicDialog,
} from "./help-center-topic-dialog";
import { HelpCenterTopicIcon } from "./help-center-topic-icon";

/** The collection's own row: `description` and `icon` are nullable columns. */
type THelpCenterTopicRow = {
  articleCount: number;
  description: string | null;
  icon: string | null;
  id: string;
  name: string;
  slug: string;
};

/**
 * The help center index.
 *
 * Sections come first and their articles hang under them, because that is the
 * shape of the product: a reader arrives at a section, not at a chronological
 * feed. The counts beside each section are the dashboard's (drafts included) —
 * the portal's read is a different number and is computed there.
 */
export function HelpCenterIndex({
  organizationId,
}: {
  organizationId: string;
}) {
  const { helpCenterTopicCollection, helpCenterArticleCollection } =
    useDashboardCollections();

  const { allowed: canManage } = usePolicy(
    hasPermission(organizationId, "helpCenterArticles.*")
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<THelpCenterTopicRow | null>(null);
  const [deleting, setDeleting] = useState<THelpCenterTopicRow | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const topicsQuery = useLiveQuery({
    queryKey: [
      "help-center-topics",
      helpCenterTopicCollection.id,
      organizationId,
    ],
    query: (q) =>
      q
        .from({ topic: helpCenterTopicCollection })
        .where(({ topic }) => eq(topic.organizationId, organizationId))
        .orderBy(({ topic }) => topic.position, "asc")
        .orderBy(({ topic }) => topic.name, "asc"),
  });

  const articlesQuery = useLiveQuery({
    queryKey: [
      "help-center-articles",
      helpCenterArticleCollection.id,
      organizationId,
    ],
    query: (q) =>
      q
        .from({ article: helpCenterArticleCollection })
        .where(({ article }) => eq(article.organizationId, organizationId))
        .orderBy(({ article }) => article.updatedAt, "desc"),
  });

  if (isLiveQueryFailed(topicsQuery) || isLiveQueryFailed(articlesQuery)) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Help center unavailable</EmptyTitle>
          <EmptyDescription>
            There was a problem loading the help center.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const topics = topicsQuery.data ?? [];
  const articles = articlesQuery.data ?? [];
  const isLoading = topicsQuery.isLoading || articlesQuery.isLoading;

  const articlesByTopic = new Map<string, typeof articles>();

  for (const article of articles) {
    const bucket = articlesByTopic.get(article.topicId);

    if (bucket === undefined) {
      articlesByTopic.set(article.topicId, [article]);
    } else {
      bucket.push(article);
    }
  }

  const confirmDeleteSection = async () => {
    if (deleting === null) {
      return;
    }

    setDeletePending(true);

    try {
      const tx = helpCenterTopicCollection.delete(deleting.id);

      // `when("settled")` is the collection's own report that the server
      // accepted the write. The optimistic removal has already happened, so a
      // refusal — a section that gained an article since this page loaded —
      // has to be surfaced rather than swallowed.
      await tx.when("settled");
      setDeleting(null);
    } catch {
      toastManager.add({
        title: "Failed to delete the section",
        type: "error",
      });
    } finally {
      setDeletePending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Help center</h1>
          <p className="text-muted-foreground text-sm">
            Documentation your customers read on your portal.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ArticleAllowance used={articles.length} />
          {canManage ? (
            <>
              <Button
                onClick={() => setCreateOpen(true)}
                type="button"
                variant="outline"
              >
                <HugeiconsIcon icon={PlusSignIcon} />
                New section
              </Button>
              <Button
                render={
                  <Link
                    params={{ organizationId }}
                    to="/$organizationId/help-center/new"
                  />
                }
                type="button"
              >
                <HugeiconsIcon icon={PlusSignIcon} />
                New article
              </Button>
            </>
          ) : null}
        </div>
      </header>

      <HelpCenterSearch organizationId={organizationId} />

      <HelpCenterAnalytics organizationId={organizationId} />

      <SkeletonLoader isLoading={isLoading}>
        <SkeletonWrapper>
          {topics.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={BookOpen01Icon} />
                </EmptyMedia>
                <EmptyTitle>No sections yet</EmptyTitle>
                <EmptyDescription>
                  A section groups articles — “Getting started”, “Billing”,
                  “Troubleshooting”.
                </EmptyDescription>
              </EmptyHeader>
              {canManage ? (
                <EmptyContent>
                  <Button onClick={() => setCreateOpen(true)} type="button">
                    Create the first section
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          ) : (
            <ul className="space-y-4">
              {topics.map((topic) => (
                <li key={topic.id}>
                  <TopicCard
                    articles={articlesByTopic.get(topic.id) ?? []}
                    canManage={canManage}
                    onDelete={() => setDeleting(topic)}
                    onEdit={() => setEditing(topic)}
                    organizationId={organizationId}
                    topic={topic}
                  />
                </li>
              ))}
            </ul>
          )}
        </SkeletonWrapper>
      </SkeletonLoader>

      <CreateHelpCenterTopicDialog
        onOpenChange={setCreateOpen}
        open={createOpen}
        organizationId={organizationId}
      />
      {/*
       * Keyed by the row: a different section is a different component, so the
       * form mounts fresh with that row's values instead of an effect resetting
       * the previous one.
       */}
      {editing === null ? null : (
        <EditHelpCenterTopicDialog
          key={editing.id}
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null);
            }
          }}
          open
          organizationId={organizationId}
          topic={editing}
        />
      )}
      <ConfirmDialog
        confirmLabel="Delete section"
        confirmLoading={deletePending}
        description="The section disappears from the help center. Sections that still hold articles cannot be deleted."
        onConfirm={confirmDeleteSection}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
          }
        }}
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? "section"}?`}
      />
    </div>
  );
}

/**
 * The plan's article allowance, shown only when it is a number.
 *
 * A paid workspace's limit is `null`, and rendering "unlimited" on every plan
 * that has no cap is noise on a page an editor already understands.
 */
function ArticleAllowance({ used }: { used: number }) {
  const planQuery = usePlan();
  const plan = planQuery.data?.plan ?? "free";
  const limit = PLAN_ENTITLEMENTS[plan].limits.helpCenterArticles;

  if (limit === null) {
    return null;
  }

  return (
    <span
      className={cn(
        "text-muted-foreground hidden text-xs tabular-nums sm:inline",
        used >= limit && "text-destructive"
      )}
    >
      {used} of {limit} articles
    </span>
  );
}

function TopicCard({
  articles,
  canManage,
  onDelete,
  onEdit,
  organizationId,
  topic,
}: {
  articles: ReadonlyArray<{
    excerpt: string;
    helpfulCount: number;
    id: string;
    notHelpfulCount: number;
    slug: string;
    status: string;
    title: string;
    viewCount: number;
  }>;
  canManage: boolean;
  onDelete: () => void;
  onEdit: () => void;
  organizationId: string;
  topic: THelpCenterTopicRow;
}) {
  const { helpCenterTopicCollection } = useDashboardCollections();

  return (
    <section className="bg-card rounded-lg border">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="bg-muted text-muted-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md">
            <HelpCenterTopicIcon className="size-4" icon={topic.icon} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{topic.name}</h2>
            <p className="text-muted-foreground truncate text-xs">
              {topic.description ?? `/help/${topic.slug}`}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="text-muted-foreground text-xs tabular-nums">
            {topic.articleCount}{" "}
            {topic.articleCount === 1 ? "article" : "articles"}
          </span>
          {canManage ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    aria-label={`Actions for ${topic.name}`}
                    size="icon"
                    type="button"
                    variant="ghost"
                  />
                }
              >
                <HugeiconsIcon icon={Ellipsis} />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem onClick={onEdit}>
                  <HugeiconsIcon icon={Edit02Icon} />
                  Edit section
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  disabled={topic.articleCount > 0}
                  onClick={onDelete}
                  variant="destructive"
                >
                  <HugeiconsIcon icon={Delete02Icon} />
                  Delete section
                </MenuItem>
              </MenuPopup>
            </Menu>
          ) : null}
        </div>
      </header>

      {articles.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6 text-sm">
          No articles in this section yet.
        </p>
      ) : (
        <ul className="divide-y">
          {articles.map((article) => {
            const votes = article.helpfulCount + article.notHelpfulCount;

            return (
              <li key={article.id}>
                <Link
                  className="group flex items-center gap-3 px-4 py-3"
                  params={{ articleId: article.id, organizationId }}
                  to="/$organizationId/help-center/$articleId"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {article.title}
                      </span>
                      {article.status === "draft" ? (
                        <Badge variant="secondary">Draft</Badge>
                      ) : null}
                      {article.status === "archived" ? (
                        <Badge variant="outline">Archived</Badge>
                      ) : null}
                    </div>
                    {article.excerpt.length > 0 ? (
                      <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">
                        {article.excerpt}
                      </p>
                    ) : null}
                  </div>

                  <div className="text-muted-foreground hidden shrink-0 items-center gap-4 text-xs tabular-nums sm:flex">
                    <span title="Views">
                      {formatCount(article.viewCount)} views
                    </span>
                    <span title="Helpful votes">
                      {votes === 0
                        ? "no votes"
                        : `${Math.round((article.helpfulCount / votes) * 100)}% helpful`}
                    </span>
                  </div>

                  <HugeiconsIcon
                    className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                    icon={ArrowRight02Icon}
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** 1200 → "1.2k". The dashboard's lists are scanned, not read. */
function formatCount(value: number): string {
  if (value < 1000) {
    return String(value);
  }

  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
}
