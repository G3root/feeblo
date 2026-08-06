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
  Folder01Icon,
  Plus,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import type { ReactNode } from "react";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { usePlan } from "~/hooks/use-plan";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import {
  useChangelogCategoryCreateDialogContext,
  useChangelogCategoryDeleteDialogContext,
  useChangelogCategoryEditDialogContext,
} from "../dialog-stores";

const FREE_PLAN_CATEGORY_LIMIT = 3;

export function ChangelogCategorySettingsTable() {
  const organizationId = useOrganizationId();
  const { changelogCategoryCollection } = useDashboardCollections();
  const createDialogStore = useChangelogCategoryCreateDialogContext();
  const editDialogStore = useChangelogCategoryEditDialogContext();
  const deleteDialogStore = useChangelogCategoryDeleteDialogContext();
  const planQuery = usePlan();

  const categoriesQuery = useLiveQuery(
    (q) =>
      q
        .from({ category: changelogCategoryCollection })
        .where(({ category }) => eq(category.organizationId, organizationId))
        .orderBy(({ category }) => category.createdAt, "asc"),
    [organizationId]
  );

  const categories = categoriesQuery?.data;
  const plan = planQuery.data?.plan;
  const categoryLimit =
    plan === "free" ? FREE_PLAN_CATEGORY_LIMIT : Number.POSITIVE_INFINITY;
  const hasReachedLimit = (categories?.length ?? 0) >= categoryLimit;
  const handleCreate = () =>
    createDialogStore.send({ type: "toggle", data: {} });

  if (categoriesQuery.isLoading) {
    return (
      <SkeletonLoader isLoading>
        <section className="space-y-6">
          <CategoryTableActions
            disabled={false}
            onSelectCategory={() => undefined}
          />
          <CategoryTableShell>
            {loadingRowIds.map((id) => (
              <CategoryTableLoadingRow key={id} />
            ))}
          </CategoryTableShell>
        </section>
      </SkeletonLoader>
    );
  }

  if (categoriesQuery.isError) {
    return (
      <section className="space-y-6">
        <CategoryTableActions
          disabled={false}
          onSelectCategory={() => undefined}
        />
        <CategoryTableErrorState />
      </section>
    );
  }

  if (categories.length === 0) {
    return (
      <section className="space-y-6">
        <CategoryTableActions
          disabled={false}
          onSelectCategory={handleCreate}
        />
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Folder01Icon} />
            </EmptyMedia>
            <EmptyTitle>No changelog categories yet</EmptyTitle>
            <EmptyDescription>
              Create your first category to start grouping changelog updates.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <PolicyGuard
              policy={hasPermission(
                organizationId,
                "changelog-categories.create"
              )}
            >
              {({ allowed }) => (
                <Button
                  disabled={!allowed}
                  onClick={handleCreate}
                  type="button"
                >
                  <HugeiconsIcon icon={Plus} />
                  <span>Create category</span>
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
      <CategoryTableActions
        disabled={hasReachedLimit}
        onSelectCategory={handleCreate}
        plan={plan}
        total={categories.length}
      />
      <CategoryTableShell>
        {categories.map((category) => (
          <CategoryTableRow
            categoryId={category.id}
            createdAt={category.createdAt}
            icon={category.icon}
            key={category.id}
            name={category.name}
            onDelete={() =>
              deleteDialogStore.send({
                type: "toggle",
                data: { categoryId: category.id },
              })
            }
            onEdit={() =>
              editDialogStore.send({
                type: "toggle",
                data: { categoryId: category.id },
              })
            }
            organizationId={organizationId}
            updatedAt={category.updatedAt}
          />
        ))}
      </CategoryTableShell>
    </section>
  );
}

function CategoryTableActions({
  disabled,
  onSelectCategory,
  plan,
  total,
}: {
  disabled: boolean;
  onSelectCategory: () => void;
  plan?: string;
  total?: number;
}) {
  const organizationId = useOrganizationId();

  return (
    <div className="flex items-center justify-end gap-3">
      {plan === "free" ? (
        <p className="text-muted-foreground text-sm">
          {total} of {FREE_PLAN_CATEGORY_LIMIT} categories used
        </p>
      ) : null}
      <SkeletonWrapper>
        <PolicyGuard
          policy={hasPermission(organizationId, "changelog-categories.create")}
        >
          {({ allowed }) => (
            <Button
              disabled={!allowed || disabled}
              onClick={onSelectCategory}
              type="button"
            >
              <HugeiconsIcon icon={Plus} />
              <span>New category</span>
            </Button>
          )}
        </PolicyGuard>
      </SkeletonWrapper>
    </div>
  );
}

type CategoryTableRowProps = {
  categoryId: string;
  createdAt: Date;
  icon: string;
  name: string;
  onDelete: () => void;
  onEdit: () => void;
  organizationId: string;
  updatedAt: Date;
};

function CategoryTableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <CategoryTableHeader />
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}

function CategoryTableRow({
  categoryId,
  createdAt,
  icon,
  name,
  onDelete,
  onEdit,
  organizationId,
  updatedAt,
}: CategoryTableRowProps) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="size-3.5 shrink-0 rounded-full"
            style={{ backgroundColor: icon }}
          />
          <span>{name}</span>
        </div>
      </TableCell>
      <TableCell>{formatDate(createdAt)}</TableCell>
      <TableCell>{formatDate(updatedAt)}</TableCell>
      <TableCell className="text-right">
        <PolicyGuard
          policy={hasPermission(organizationId, "changelog-categories.*")}
        >
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
                    <span className="sr-only">
                      Open actions for {categoryId}
                    </span>
                  </Button>
                )}
              />
              <MenuPopup align="end" className="w-40">
                <MenuItem disabled={!allowed} onClick={onEdit}>
                  <HugeiconsIcon
                    className="text-muted-foreground"
                    icon={Edit}
                  />
                  <span>Edit</span>
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

function CategoryTableLoadingRow() {
  const placeholderDate = formatDate(new Date());

  return (
    <TableRow>
      <TableCell className="font-medium">
        <SkeletonWrapper>
          <span>Loading category</span>
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

function CategoryTableErrorState() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={Folder01Icon} />
        </EmptyMedia>
        <EmptyTitle>Unable to load categories</EmptyTitle>
        <EmptyDescription>
          Something went wrong while loading categories. Refresh the page and
          try again.
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

const loadingRowIds = ["category-loading-1", "category-loading-2"];

const headers = ["Category", "Created", "Updated", "Actions"];

function CategoryTableHeader() {
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
