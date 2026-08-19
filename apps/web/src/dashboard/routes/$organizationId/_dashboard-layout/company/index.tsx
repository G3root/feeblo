import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@feeblo/ui/menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@feeblo/ui/table";
import {
  anyPolicy,
  hasPermission,
  PolicyGuard,
} from "@feeblo/web-shared/use-policy";
import {
  Building02Icon,
  Delete02Icon,
  Edit,
  Ellipsis,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";

import { useUpgradePlanDialogContext } from "~/features/billing/dialog-stores";
import { useEntitlements } from "~/hooks/use-entitlements";

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
import {
  type CustomAttributeDefinition,
  type CustomAttributeValue,
  formatCustomAttributeValue,
} from "~/features/custom-attribute/components/custom-attribute-fields";
import {
  companyAttributeDefinitionCollection,
  companyAttributeValueCollection,
  companyCollection,
} from "~/lib/collections";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/company/"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await Promise.all([
      companyCollection.preload(),
      companyAttributeDefinitionCollection.preload(),
      companyAttributeValueCollection.preload(),
    ]);
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
  const {
    companyAttributeDefinitionCollection,
    companyCollection,
    contactCollection,
  } = useDashboardCollections();
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
  const { data: contacts = [] } = useLiveQuery(
    (q) =>
      q
        .from({ contact: contactCollection })
        .where(({ contact }) => eq(contact.organizationId, organizationId)),
    [organizationId]
  );
  const definitionsQuery = useLiveQuery(
    (q) =>
      q
        .from({ definition: companyAttributeDefinitionCollection })
        .where(({ definition }) =>
          eq(definition.organizationId, organizationId)
        )
        .orderBy(({ definition }) => definition.createdAt, "asc"),
    [organizationId]
  );
  const definitions = definitionsQuery.data ?? [];

  const { entitlements } = useEntitlements();
  const crmLimit = entitlements.limits.crmEntries;
  const totalCrmEntries = companies.length + contacts.length;
  const hasReachedCrmLimit =
    crmLimit !== null && totalCrmEntries >= crmLimit;
  const upgradePlanStore = useUpgradePlanDialogContext();
  const openCreateDialog = () => {
    if (hasReachedCrmLimit) {
      upgradePlanStore.send({ type: "toggle" });
      return;
    }
    createDialogStore.send({ type: "toggle" });
  };

  if (!companiesQuery.isLoading && companies.length === 0) {
    return (
      <div className="p-3">
        {crmLimit !== null ? (
          <div className="mb-3 flex justify-end">
            <p className="text-muted-foreground text-sm">
              {totalCrmEntries} of {crmLimit} CRM entries used
              {hasReachedCrmLimit ? " — upgrade for unlimited" : ""}
            </p>
          </div>
        ) : null}
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
            <PolicyGuard
              policy={hasPermission(organizationId, "companies.create")}
            >
              {({ allowed }) => (
                <Button
                  disabled={!allowed || hasReachedCrmLimit}
                  onClick={openCreateDialog}
                  type="button"
                  variant="brand"
                >
                  <HugeiconsIcon icon={Building02Icon} />
                  Create company
                </Button>
              )}
            </PolicyGuard>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          {crmLimit !== null ? (
            <p className="text-muted-foreground text-sm">
              {totalCrmEntries} of {crmLimit} CRM entries used
              {hasReachedCrmLimit ? " — upgrade for unlimited" : ""}
            </p>
          ) : null}
        </div>
        <PolicyGuard policy={hasPermission(organizationId, "companies.create")}>
          {({ allowed }) => (
            <Button
              disabled={!allowed || hasReachedCrmLimit}
              onClick={openCreateDialog}
              type="button"
              variant="brand"
            >
              <HugeiconsIcon icon={Building02Icon} />
              Create company
            </Button>
          )}
        </PolicyGuard>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>External ID</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Updated</TableHead>
            {definitions.map((definition) => (
              <TableHead key={definition.id}>{definition.name}</TableHead>
            ))}
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
              <TableCell>{formatSource(company.source)}</TableCell>
              <TableCell>{formatDate(company.createdAt)}</TableCell>
              <TableCell>{formatDate(company.updatedAt)}</TableCell>
              <CompanyAttributeCells
                companyId={company.id}
                definitions={definitions}
              />
              <TableCell className="text-right">
                <PolicyGuard
                  policy={anyPolicy(
                    hasPermission(organizationId, "companies.update"),
                    hasPermission(organizationId, "companies.*")
                  )}
                >
                  {({ allowed: canUseAnyAction }) =>
                    canUseAnyAction ? (
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
                                Open actions for {company.name}
                              </span>
                            </Button>
                          )}
                        />
                        <MenuPopup align="end" className="w-40">
                          <PolicyGuard
                            policy={hasPermission(
                              organizationId,
                              "companies.update"
                            )}
                          >
                            {({ allowed }) => (
                              <MenuItem
                                disabled={!allowed}
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
                              </MenuItem>
                            )}
                          </PolicyGuard>
                          <PolicyGuard
                            policy={hasPermission(
                              organizationId,
                              "companies.*"
                            )}
                          >
                            {({ allowed }) => (
                              <MenuItem
                                disabled={!allowed}
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
                              </MenuItem>
                            )}
                          </PolicyGuard>
                        </MenuPopup>
                      </Menu>
                    ) : null
                  }
                </PolicyGuard>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CompanyAttributeCells({
  companyId,
  definitions,
}: {
  companyId: string;
  definitions: CustomAttributeDefinition[];
}) {
  const { companyAttributeValueCollection } = useDashboardCollections();
  const valuesQuery = useLiveQuery(
    (q) =>
      q
        .from({ value: companyAttributeValueCollection })
        .where(({ value }) => eq(value.companyId, companyId)),
    [companyId]
  );
  const valuesByAttributeId = new Map(
    (valuesQuery.data ?? []).map((value) => [value.attributeId, value])
  );

  return definitions.map((definition) => (
    <TableCell key={definition.id}>
      {formatCustomAttributeValue(
        // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
        valuesByAttributeId.get(definition.id) as
          | CustomAttributeValue
          | undefined
      )}
    </TableCell>
  ));
}

const mediumDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});

function formatDate(date: Date) {
  return mediumDateFormatter.format(date);
}

function formatSource(source: "DASHBOARD" | "WIDGET" | "API" | "IMPORT") {
  return {
    DASHBOARD: "Dashboard",
    WIDGET: "Widget",
    API: "API",
    IMPORT: "Import",
  }[source];
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
