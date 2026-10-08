import type { DragDropEventHandlers } from "@dnd-kit/react";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import type { TPostStatusType } from "@feeblo/domain/post-status/schema";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@feeblo/ui/menu";
import { SkeletonLoader, SkeletonWrapper } from "@feeblo/ui/skeleton-loader";
import { toastManager } from "@feeblo/ui/toast";
import { cn } from "@feeblo/ui/utils";
import {
  BoardIconMap,
  formatPostStatus,
} from "@feeblo/web-shared/board/constants";
import { hasPermission, PolicyGuard } from "@feeblo/web-shared/use-policy";
import {
  Delete02Icon,
  DragDropVerticalIcon,
  Edit,
  Ellipsis,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useCallback, useState } from "react";

import { useOrganizationId } from "~/hooks/use-organization-id";
import { fetchRpc } from "~/lib/runtime";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import {
  usePostStatusCreateDialogContext,
  usePostStatusDeleteDialogContext,
  usePostStatusEditDialogContext,
} from "../dialog-stores";
import { postStatusSections } from "../sections";

type StatusRow = {
  color?: string | null;
  id: string;
  isDefault: boolean;
  label: string;
  orderIndex: number;
  type: TPostStatusType;
};

export function PostStatusSettings() {
  const organizationId = useOrganizationId();
  const { postStatusCollection } = useDashboardCollections();
  const createDialog = usePostStatusCreateDialogContext();

  /**
   * The order a section shows between a drop and the server confirming it.
   *
   * A reorder cannot ride the collection's own `onUpdate`: that path writes a
   * status's label, colour and section, not its position. So the drop is sent
   * as one `PostStatusReorder` call and the list holds the dropped order until
   * the refetch lands, rather than snapping back and forward.
   */
  const [pendingOrder, setPendingOrder] = useState<{
    ids: string[];
    type: TPostStatusType;
  } | null>(null);

  const statusQuery = useLiveQuery({
    query: (q) =>
      q
        .from({ postStatus: postStatusCollection })
        .where(({ postStatus }) =>
          eq(postStatus.organizationId, organizationId)
        ),
  });

  const statuses: StatusRow[] = statusQuery?.data ?? [];

  const commitOrder = useCallback(
    async (type: TPostStatusType, orderedIds: string[]) => {
      setPendingOrder({ ids: orderedIds, type });

      try {
        await fetchRpc((rpc) =>
          rpc.PostStatusReorder({ organizationId, type, orderedIds })
        );
        await postStatusCollection.utils.refetch();
      } catch {
        toastManager.add({
          title: "Failed to reorder statuses",
          type: "error",
        });
      } finally {
        setPendingOrder(null);
      }
    },
    [organizationId, postStatusCollection]
  );

  const handleDragEnd = useCallback<DragDropEventHandlers["onDragEnd"]>(
    (event) => {
      const { source, target } = event.operation;

      if (event.canceled || source?.type !== "status") {
        return;
      }

      // Resolved against this page's own rows rather than by inspecting the
      // event's payload: an id that is not one of these statuses is not ours to
      // order, whatever it carries.
      const sourceRow = statuses.find((status) => status.id === source.id);
      const targetRow = statuses.find((status) => status.id === target?.id);

      // A drop onto another section is ignored: dragging is for ordering
      // within a section, and moving a status between sections is a deliberate
      // change the edit dialog owns.
      if (
        sourceRow === undefined ||
        targetRow === undefined ||
        targetRow.type !== sourceRow.type ||
        targetRow.id === sourceRow.id
      ) {
        return;
      }

      const sectionIds = statuses
        .filter((status) => status.type === sourceRow.type)
        .toSorted((left, right) => left.orderIndex - right.orderIndex)
        .map((status) => status.id);

      const from = sectionIds.indexOf(sourceRow.id);
      const to = sectionIds.indexOf(targetRow.id);

      if (from === -1 || to === -1) {
        return;
      }

      void commitOrder(
        sourceRow.type,
        sectionIds.toSpliced(from, 1).toSpliced(to, 0, sourceRow.id)
      );
    },
    [commitOrder, statuses]
  );

  if (statusQuery.isLoading) {
    return (
      <SkeletonLoader isLoading>
        <div className="space-y-8">
          {postStatusSections.map((section) => (
            <PostStatusSectionShell key={section.type} label={section.label}>
              <PostStatusLoadingRow />
            </PostStatusSectionShell>
          ))}
        </div>
      </SkeletonLoader>
    );
  }

  return (
    <DragDropProvider onDragEnd={handleDragEnd}>
      <div className="space-y-8">
        {postStatusSections.map((section) => {
          const rows = statuses
            .filter((status) => status.type === section.type)
            .toSorted((left, right) => left.orderIndex - right.orderIndex);

          const ordered =
            pendingOrder?.type === section.type
              ? pendingOrder.ids
                  .map((id) => rows.find((row) => row.id === id))
                  .filter((row): row is StatusRow => row !== undefined)
              : rows;

          return (
            <PostStatusSectionShell
              action={
                <PolicyGuard
                  policy={hasPermission(organizationId, "statuses.create")}
                >
                  {({ allowed }) => (
                    <Button
                      disabled={!allowed}
                      onClick={() =>
                        createDialog.send({
                          type: "toggle",
                          data: { type: section.type },
                        })
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <HugeiconsIcon icon={PlusSignIcon} />
                      <span>New</span>
                    </Button>
                  )}
                </PolicyGuard>
              }
              key={section.type}
              label={section.label}
            >
              {ordered.length === 0 ? (
                <p className="text-muted-foreground px-4 py-3 text-sm">
                  No statuses in this section yet.
                </p>
              ) : (
                ordered.map((status, index) => (
                  <PostStatusRow
                    index={index}
                    key={status.id}
                    organizationId={organizationId}
                    status={status}
                  />
                ))
              )}
            </PostStatusSectionShell>
          );
        })}
      </div>
    </DragDropProvider>
  );
}

function PostStatusSectionShell({
  action,
  children,
  label,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium">{label}</h2>
        {action}
      </header>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function PostStatusRow({
  index,
  organizationId,
  status,
}: {
  index: number;
  organizationId: string;
  status: StatusRow;
}) {
  const editDialog = usePostStatusEditDialogContext();
  const deleteDialog = usePostStatusDeleteDialogContext();
  const { ref, handleRef, isDragging } = useSortable({
    id: status.id,
    accept: "status",
    type: "status",
    index,
    group: status.type,
    data: { type: status.type },
  });

  const Icon = BoardIconMap[status.type];
  const label = status.label || formatPostStatus(status.type);

  return (
    <div
      className={cn(
        "bg-muted/40 flex items-center gap-3 rounded-xl px-3 py-2.5 transition-opacity",
        isDragging && "opacity-60"
      )}
      ref={ref}
    >
      <button
        aria-label={`Reorder ${label}`}
        className="text-muted-foreground hover:text-foreground cursor-grab rounded-md p-1 transition-colors active:cursor-grabbing"
        ref={handleRef}
        type="button"
      >
        <HugeiconsIcon className="size-4" icon={DragDropVerticalIcon} />
      </button>

      <span
        className="inline-flex items-center justify-center"
        style={status.color ? { color: status.color } : undefined}
      >
        <HugeiconsIcon className="size-4" icon={Icon} strokeWidth={2.5} />
      </span>

      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {label}
      </span>

      {status.isDefault ? <Badge variant="secondary">Default</Badge> : null}

      <PolicyGuard policy={hasPermission(organizationId, "statuses.*")}>
        {({ allowed }) => (
          <Menu>
            <MenuTrigger
              render={(triggerProps) => (
                <Button
                  {...triggerProps}
                  disabled={!allowed}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <HugeiconsIcon icon={Ellipsis} />
                  <span className="sr-only">Open actions for {label}</span>
                </Button>
              )}
            />
            <MenuPopup align="end" className="w-44">
              <MenuItem
                onClick={() =>
                  editDialog.send({
                    type: "toggle",
                    data: { statusId: status.id },
                  })
                }
              >
                <HugeiconsIcon className="text-muted-foreground" icon={Edit} />
                <span>Edit</span>
              </MenuItem>
              {status.isDefault ? null : (
                <MenuItem
                  onClick={() =>
                    deleteDialog.send({
                      type: "toggle",
                      data: { statusId: status.id },
                    })
                  }
                  variant="destructive"
                >
                  <HugeiconsIcon icon={Delete02Icon} />
                  <span>Delete</span>
                </MenuItem>
              )}
            </MenuPopup>
          </Menu>
        )}
      </PolicyGuard>
    </div>
  );
}

function PostStatusLoadingRow() {
  return (
    <div className="bg-muted/40 flex items-center gap-3 rounded-xl px-3 py-2.5">
      <SkeletonWrapper>
        <span className="text-sm">Loading status</span>
      </SkeletonWrapper>
    </div>
  );
}
