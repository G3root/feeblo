import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@feeblo/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@feeblo/ui/table";
import {
  Building02Icon,
  Delete02Icon,
  Edit,
  Ellipsis,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { CompanyCreateDialog } from "~/features/contact/components/company-create-dialog";
import { CompanyDeleteDialog } from "~/features/contact/components/company-delete-dialog";
import { CompanyEditDialog } from "~/features/contact/components/company-edit-dialog";
import {
  CompanyCreateDialogProvider,
  CompanyDeleteDialogProvider,
  CompanyEditDialogProvider,
  useCompanyCreateDialogContext,
  useCompanyDeleteDialogContext,
  useCompanyEditDialogContext,
} from "~/features/contact/dialog-stores";
import { companyCollection } from "~/lib/collections";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/company/"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await companyCollection.preload();
    return null;
  },
});

function RouteComponent() {
  return (
    <CompanyCreateDialogProvider>
      <CompanyEditDialogProvider>
        <CompanyDeleteDialogProvider>
          <CompanyPage />
          <CompanyCreateDialog />
          <CompanyEditDialog />
          <CompanyDeleteDialog />
        </CompanyDeleteDialogProvider>
      </CompanyEditDialogProvider>
    </CompanyCreateDialogProvider>
  );
}

function CompanyPage() {
  const { organizationId } = Route.useParams();
  const { companyCollection } = useDashboardCollections();
  const createDialogStore = useCompanyCreateDialogContext();
  const editDialogStore = useCompanyEditDialogContext();
  const deleteDialogStore = useCompanyDeleteDialogContext();
  const companiesQuery = useLiveQuery(
    (q) =>
      q
        .from({ company: companyCollection })
        .where(({ company }) => eq(company.organizationId, organizationId))
        .orderBy(({ company }) => company.updatedAt, "desc"),
    [organizationId]
  );
  const companies = companiesQuery.data ?? [];

  const openCreateDialog = () => createDialogStore.send({ type: "toggle" });

  if (!companiesQuery.isLoading && companies.length === 0) {
    return (
      <div className="p-3">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Building02Icon} />
            </EmptyMedia>
            <EmptyTitle>No companies yet</EmptyTitle>
            <EmptyDescription>
              Add a company to group the contacts in your workspace.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={openCreateDialog} type="button">
              <HugeiconsIcon icon={Building02Icon} />
              Create company
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="mb-3 flex justify-end">
        <Button onClick={openCreateDialog} type="button">
          <HugeiconsIcon icon={Building02Icon} />
          Create company
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>External ID</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {companies.map((company) => (
            <TableRow key={company.id}>
              <TableCell className="font-medium">{company.name}</TableCell>
              <TableCell>{company.externalId ?? "—"}</TableCell>
              <TableCell>{formatDate(company.createdAt)}</TableCell>
              <TableCell>{formatDate(company.updatedAt)}</TableCell>
              <TableCell>
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
                          Open actions for {company.name}
                        </span>
                      </Button>
                    )}
                  />
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem
                      onClick={() =>
                        editDialogStore.send({
                          type: "toggle",
                          data: { companyId: company.id },
                        })
                      }
                    >
                      <HugeiconsIcon
                        className="text-muted-foreground"
                        icon={Edit}
                      />
                      <span>Edit</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        deleteDialogStore.send({
                          type: "toggle",
                          data: { companyId: company.id },
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
  );
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}

import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
