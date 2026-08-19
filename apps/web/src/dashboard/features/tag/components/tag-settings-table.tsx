import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@feeblo/ui/menu";
import { SkeletonLoader, SkeletonWrapper } from "@feeblo/ui/skeleton-loader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@feeblo/ui/table";
import { cn } from "@feeblo/ui/utils";
import { hasPermission, PolicyGuard } from "@feeblo/web-shared/use-policy";
import {
  Delete02Icon,
  Edit,
  Ellipsis,
  Plus,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import type { ReactNode } from "react";

import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import {
  useTagCreateDialogContext,
  useTagDeleteDialogContext,
  useTagEditDialogContext,
} from "../dialog-stores";

type TagType = "FEEDBACK" | "CHANGELOG";

type TagSettingsTableProps = {
  emptyDescription: string;
  emptyTitle: string;

  type: TagType;
};

export function TagSettingsTable(props: TagSettingsTableProps) {
  const { emptyDescription, emptyTitle, type } = props;
  const organizationId = useOrganizationId();
  const { tagCollection } = useDashboardCollections();
  const createDialogStore = useTagCreateDialogContext();
  const editDialogStore = useTagEditDialogContext();
  const deleteDialogStore = useTagDeleteDialogContext();

  const tagsQuery = useLiveQuery(
    (q) =>
      q
        .from({ tag: tagCollection })
        .where(({ tag }) =>
          and(eq(tag.organizationId, organizationId), eq(tag.type, type))
        )
        .orderBy(({ tag }) => tag.updatedAt, "desc"),
    [organizationId, type]
  );

  const tags = tagsQuery?.data;
  const handleCreate = () =>
    createDialogStore.send({ type: "toggle", data: { type } });

  if (tagsQuery.isLoading) {
    return (
      <SkeletonLoader isLoading>
        <section className="space-y-6">
          <TagTableActions
            onCreate={handleCreate}
            organizationId={organizationId}
          />
          <TagTableShell>
            {loadingRowIds.map((id) => (
              <TagTableLoadingRow key={id} />
            ))}
          </TagTableShell>
        </section>
      </SkeletonLoader>
    );
  }

  if (tagsQuery.isError) {
    return (
      <section className="space-y-6">
        <TagTableActions
          onCreate={handleCreate}
          organizationId={organizationId}
        />
        <TagTableErrorState />
      </section>
    );
  }

  if (tags.length === 0) {
    return (
      <section className="space-y-6">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Tag01Icon} />
            </EmptyMedia>
            <EmptyTitle>{emptyTitle}</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <PolicyGuard policy={hasPermission(organizationId, "tags.create")}>
              {({ allowed }) => (
                <Button
                  disabled={!allowed}
                  onClick={handleCreate}
                  type="button"
                  variant="brand"
                >
                  <HugeiconsIcon icon={Plus} />
                  <span>Create tag</span>
                </Button>
              )}
            </PolicyGuard>
          </EmptyContent>
        </Empty>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <TagTableActions
        onCreate={handleCreate}
        organizationId={organizationId}
      />
      <TagTableShell>
        {tags.map((tag) => (
          <TagTableRow
            createdAt={tag.createdAt}
            key={tag.id}
            name={tag.name}
            onDelete={() =>
              deleteDialogStore.send({
                type: "toggle",
                data: { tagId: tag.id },
              })
            }
            onEdit={() =>
              editDialogStore.send({
                type: "toggle",
                data: { tagId: tag.id },
              })
            }
            organizationId={organizationId}
            updatedAt={tag.updatedAt}
          />
        ))}
      </TagTableShell>
    </section>
  );
}

function TagTableActions({
  onCreate,
  organizationId,
}: {
  onCreate: () => void;
  organizationId: string;
}) {
  return (
    <div className="flex items-center justify-end">
      <SkeletonWrapper>
        <PolicyGuard policy={hasPermission(organizationId, "tags.create")}>
          {({ allowed }) => (
            <Button
              variant="brand"
              disabled={!allowed}
              onClick={onCreate}
              type="button"
            >
              <HugeiconsIcon icon={Plus} />
              <span>New tag</span>
            </Button>
          )}
        </PolicyGuard>
      </SkeletonWrapper>
    </div>
  );
}

type TagTableRowProps = {
  createdAt: Date;
  name: string;
  onDelete: () => void;
  onEdit: () => void;
  organizationId: string;
  updatedAt: Date;
};

function TagTableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TagTableHeader />
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}

function TagTableRow({
  createdAt,
  name,
  onDelete,
  onEdit,
  organizationId,
  updatedAt,
}: TagTableRowProps) {
  return (
    <TableRow>
      <TableCell className="font-medium">{name}</TableCell>
      <TableCell>{formatDate(createdAt)}</TableCell>
      <TableCell>{formatDate(updatedAt)}</TableCell>
      <TableCell className="text-right">
        <PolicyGuard policy={hasPermission(organizationId, "tags.*")}>
          {({ allowed }) => (
            <Menu>
              <MenuTrigger
                render={(triggerProps) => (
                  <Button
                    {...triggerProps}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <HugeiconsIcon icon={Ellipsis} />
                    <span className="sr-only">Open actions for {name}</span>
                  </Button>
                )}
              />
              <MenuPopup align="end" className="w-40">
                <MenuItem disabled={!allowed} onClick={onEdit}>
                  <HugeiconsIcon
                    className="text-muted-foreground"
                    icon={Edit}
                  />
                  <span>Rename</span>
                </MenuItem>
                <MenuItem
                  disabled={!allowed}
                  onClick={onDelete}
                  variant="destructive"
                >
                  <HugeiconsIcon icon={Delete02Icon} />
                  <span>Delete</span>
                </MenuItem>
              </MenuPopup>
            </Menu>
          )}
        </PolicyGuard>
      </TableCell>
    </TableRow>
  );
}

function TagTableLoadingRow() {
  const placeholderDate = formatDate(new Date());

  return (
    <TableRow>
      <TableCell className="font-medium">
        <SkeletonWrapper>
          <span>Loading tag</span>
        </SkeletonWrapper>
      </TableCell>
      <TableCell>
        <SkeletonWrapper>
          <span>{placeholderDate}</span>
        </SkeletonWrapper>
      </TableCell>
      <TableCell>
        <SkeletonWrapper>
          <span>{placeholderDate}</span>
        </SkeletonWrapper>
      </TableCell>
      <TableCell className="text-right">
        <SkeletonWrapper>
          <Button size="icon-sm" type="button" variant="ghost">
            <HugeiconsIcon icon={Ellipsis} />
            <span className="sr-only">Open actions</span>
          </Button>
        </SkeletonWrapper>
      </TableCell>
    </TableRow>
  );
}

function TagTableErrorState() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={Tag01Icon} />
        </EmptyMedia>
        <EmptyTitle>Unable to load tags</EmptyTitle>
        <EmptyDescription>
          Something went wrong while loading tags. Refresh the page and try
          again.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

const mediumDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});

function formatDate(date: Date) {
  return mediumDateFormatter.format(date);
}

const loadingRowIds = ["tag-loading-1", "tag-loading-2"];

const headers = ["Name", "Created", "Updated", "Actions"];

function TagTableHeader() {
  return (
    <TableHeader>
      <TableRow>
        {headers.map((item, index) => (
          <TableHead
            className={cn(index === 3 && "w-16 text-right")}
            key={item}
          >
            {item}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}
