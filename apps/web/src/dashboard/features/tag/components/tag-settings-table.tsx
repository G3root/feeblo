import {
  Delete02Icon,
  Edit,
  Ellipsis,
  Plus,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { tagCollection } from "~/lib/collections";
import {
  useTagCreateDialogContext,
  useTagDeleteDialogContext,
  useTagEditDialogContext,
} from "../dialog-stores";

type TagType = "FEEDBACK" | "CHANGELOG";

type TagSettingsTableProps = {
  description: string;
  emptyDescription: string;
  emptyTitle: string;
  title: string;
  type: TagType;
};

type TagRow = {
  createdAt: Date;
  id: string;
  name: string;
  type: TagType;
  updatedAt: Date;
};

export function TagSettingsTable(props: TagSettingsTableProps) {
  const { description, emptyDescription, emptyTitle, title, type } = props;
  const organizationId = useOrganizationId();
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

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="font-medium text-sm">{title}</h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        <Button
          onClick={() =>
            createDialogStore.send({ type: "toggle", data: { type } })
          }
          type="button"
        >
          <HugeiconsIcon icon={Plus} />
          <span>New tag</span>
        </Button>
      </div>

      {tagsQuery.isLoading && !tagsQuery.isError ? (
        <TagTableLoadingState />
      ) : null}

      {tagsQuery.isError && !tagsQuery.isLoading ? (
        <TagTableErrorState />
      ) : null}

      {!(tagsQuery.isLoading || tagsQuery.isError) && tags.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Tag01Icon} />
            </EmptyMedia>
            <EmptyTitle>{emptyTitle}</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              onClick={() =>
                createDialogStore.send({ type: "toggle", data: { type } })
              }
              type="button"
            >
              <HugeiconsIcon icon={Plus} />
              <span>Create tag</span>
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}

      {!(tagsQuery.isLoading || tagsQuery.isError) && tags.length > 0 ? (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-16 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tags.map((tag) => (
                <TableRow key={tag.id}>
                  <TableCell className="font-medium">{tag.name}</TableCell>
                  <TableCell>{formatDate(tag.createdAt)}</TableCell>
                  <TableCell>{formatDate(tag.updatedAt)}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={(triggerProps) => (
                          <Button
                            {...triggerProps}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <HugeiconsIcon icon={Ellipsis} />
                            <span className="sr-only">
                              Open actions for {tag.name}
                            </span>
                          </Button>
                        )}
                      />
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onClick={() =>
                            editDialogStore.send({
                              type: "toggle",
                              data: { tagId: tag.id },
                            })
                          }
                        >
                          <HugeiconsIcon
                            className="text-muted-foreground"
                            icon={Edit}
                          />
                          <span>Rename</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            deleteDialogStore.send({
                              type: "toggle",
                              data: { tagId: tag.id },
                            })
                          }
                          variant="destructive"
                        >
                          <HugeiconsIcon icon={Delete02Icon} />
                          <span>Delete</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </section>
  );
}

export function TagTableLoadingState() {
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="w-16 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 4 }).map((_, index) => (
            <TableRow key={index}>
              <TableCell>
                <Skeleton className="h-4 w-32" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-24" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-24" />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end">
                  <Skeleton className="h-8 w-8 rounded-full" />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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

function formatDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}
