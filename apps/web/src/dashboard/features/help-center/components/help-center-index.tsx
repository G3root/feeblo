import { useAtomSet } from "@effect/atom-react";
import type { THelpCenterTopicWithCount } from "@feeblo/domain/help-center-topic/schema";
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
import { FloatingActionButton } from "@feeblo/ui/floating-action-button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@feeblo/ui/menu";
import { SkeletonLoader, SkeletonWrapper } from "@feeblo/ui/skeleton-loader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@feeblo/ui/table";
import { toastManager } from "@feeblo/ui/toast";
import { isLiveQueryFailed } from "@feeblo/web-shared/collections";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  BookOpen01Icon,
  Delete02Icon,
  Edit02Icon,
  Ellipsis,
  Plus,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { reorderHelpCenterTopicsAtom } from "../atoms";
import { HelpCenterArticleUsage } from "./help-center-article-usage";
import { HelpCenterSearch } from "./help-center-search";
import {
  CreateHelpCenterTopicDialog,
  EditHelpCenterTopicDialog,
} from "./help-center-topic-dialog";
import { HelpCenterTopicIcon } from "./help-center-topic-icon";

const mediumDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});

// Title and count survive on a phone; the rest is the table's own scroll.
const headItems = [
  { className: "", label: "Section" },
  { className: "hidden sm:table-cell", label: "Articles" },
  { className: "hidden sm:table-cell", label: "Updated" },
];

/**
 * The help center's index: the sections, and nothing else.
 *
 * Articles live one level down, in their section's page. A reader arrives at a
 * section, not at a chronological feed, and an index that inlined every
 * article made a workspace with a dozen sections an unscannable page.
 *
 * The article allowance is shown here because the plan counts articles across
 * the whole workspace, not per section, and this is the page that lists all of
 * them.
 */
export function HelpCenterIndex({
  organizationId,
}: {
  organizationId: string;
}) {
  const { helpCenterTopicCollection } = useDashboardCollections();

  const { allowed: canManage } = usePolicy(
    hasPermission(organizationId, "helpCenterArticles.*")
  );

  const [createOpen, setCreateOpen] = useState(false);

  const [editing, setEditing] = useState<THelpCenterTopicWithCount | null>(
    null
  );

  const [deleting, setDeleting] = useState<THelpCenterTopicWithCount | null>(
    null
  );

  const [deletePending, setDeletePending] = useState(false);

  const [reorderPending, setReorderPending] = useState(false);

  const reorderTopics = useAtomSet(reorderHelpCenterTopicsAtom, {
    mode: "promise",
  });

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

  if (isLiveQueryFailed(topicsQuery)) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Help center unavailable</EmptyTitle>
          <EmptyDescription>
            There was a problem loading the sections.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const topics = topicsQuery.data ?? [];

  const articleTotal = topics.reduce(
    (total, topic) => total + topic.articleCount,
    0
  );

  /**
   * Moves a section one row up or down.
   *
   * The write names the complete order because that is the operation the
   * server accepts; a sequence of per-row position updates would leave a
   * half-applied reorder behind if one call failed. The refetch is best-effort:
   * the reorder already succeeded, and a failed read is the list's next-load
   * problem rather than a failed move.
   */
  const moveTopic = async (topicId: string, direction: -1 | 1) => {
    const index = topics.findIndex((topic) => topic.id === topicId);
    const target = index + direction;

    if (index === -1 || target < 0 || target >= topics.length) {
      return;
    }

    const topicIds = topics.map((topic) => topic.id);
    const moved = topicIds[index];
    topicIds[index] = topicIds[target];
    topicIds[target] = moved;

    setReorderPending(true);

    try {
      await reorderTopics({ payload: { organizationId, topicIds } });
      await helpCenterTopicCollection.utils.refetch().catch(() => undefined);
    } catch {
      toastManager.add({
        title: "Failed to reorder the sections",
        type: "error",
      });
    } finally {
      setReorderPending(false);
    }
  };

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
    <div className="mx-auto w-full">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <HelpCenterArticleUsage used={articleTotal} />
        <div className="ml-auto flex items-center gap-2">
          <HelpCenterSearch organizationId={organizationId} />
          {canManage ? (
            <>
              <Button
                className="max-md:hidden"
                onClick={() => setCreateOpen(true)}
                type="button"
                variant="brand"
              >
                <HugeiconsIcon icon={Plus} />
                New section
              </Button>
              <FloatingActionButton
                icon={<HugeiconsIcon icon={Plus} />}
                onClick={() => setCreateOpen(true)}
              >
                New section
              </FloatingActionButton>
            </>
          ) : null}
        </div>
      </div>

      <SkeletonLoader isLoading={topicsQuery.isLoading}>
        {!topicsQuery.isLoading && topics.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={BookOpen01Icon} />
              </EmptyMedia>
              <EmptyTitle>No sections yet</EmptyTitle>
              <EmptyDescription>
                A section holds the articles for one topic, like Billing or
                Getting started.
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
          <div className="p-3">
            <Table>
              <TableHeader>
                <TableRow>
                  {headItems.map((item) => (
                    <TableHead className={item.className} key={item.label}>
                      <SkeletonWrapper>{item.label}</SkeletonWrapper>
                    </TableHead>
                  ))}
                  <TableHead className="w-px">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topics.map((topic, index) => (
                  <TableRow key={topic.id}>
                    <TableCell className="whitespace-normal">
                      <Link
                        className="flex items-center gap-2"
                        params={{ organizationId, topicId: topic.id }}
                        to="/$organizationId/help-center/$topicId"
                      >
                        <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
                          <HelpCenterTopicIcon
                            className="size-4"
                            icon={topic.icon}
                          />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {topic.name}
                          </span>
                          <span className="text-muted-foreground block truncate text-xs">
                            {topic.description ?? `/help/${topic.slug}`}
                          </span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <span className="tabular-nums">{topic.articleCount}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden sm:table-cell">
                      {mediumDateFormatter.format(topic.updatedAt)}
                    </TableCell>
                    <TableCell>
                      {canManage ? (
                        <Menu>
                          <MenuTrigger
                            render={
                              <Button
                                aria-label={`Actions for ${topic.name}`}
                                size="icon-xs"
                                type="button"
                                variant="ghost"
                              />
                            }
                          >
                            <HugeiconsIcon icon={Ellipsis} />
                          </MenuTrigger>
                          <MenuPopup align="end">
                            <MenuItem onClick={() => setEditing(topic)}>
                              <HugeiconsIcon icon={Edit02Icon} />
                              Edit section
                            </MenuItem>
                            <MenuSeparator />
                            <MenuItem
                              disabled={reorderPending || index === 0}
                              onClick={() => void moveTopic(topic.id, -1)}
                            >
                              <HugeiconsIcon icon={ArrowUp01Icon} />
                              Move up
                            </MenuItem>
                            <MenuItem
                              disabled={
                                reorderPending || index === topics.length - 1
                              }
                              onClick={() => void moveTopic(topic.id, 1)}
                            >
                              <HugeiconsIcon icon={ArrowDown01Icon} />
                              Move down
                            </MenuItem>
                            <MenuSeparator />
                            <MenuItem
                              disabled={topic.articleCount > 0}
                              onClick={() => setDeleting(topic)}
                              variant="destructive"
                            >
                              <HugeiconsIcon icon={Delete02Icon} />
                              Delete section
                            </MenuItem>
                          </MenuPopup>
                        </Menu>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
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
