import { PLAN_ENTITLEMENTS } from "@feeblo/domain/plan-entitlements";
import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@feeblo/ui/table";
import { hasPermission, PolicyGuard } from "@feeblo/web-shared/use-policy";
import { UserAdd01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";

import { useUpgradePlanDialogContext } from "~/features/billing/dialog-stores";
import { CompanyEditDialog } from "~/features/contact/components/company-edit-dialog";
import { ContactCreateDialog } from "~/features/contact/components/contact-create-dialog";
import { ContactDeleteDialog } from "~/features/contact/components/contact-delete-dialog";
import { ContactEditDialog } from "~/features/contact/components/contact-edit-dialog";
import { ContactTableRow } from "~/features/contact/components/contact-table-row";
import {
  CompanyEditDialogProvider,
  ContactCreateDialogProvider,
  ContactDeleteDialogProvider,
  ContactEditDialogProvider,
  useCompanyEditDialogContext,
  useContactCreateDialogContext,
  useContactDeleteDialogContext,
  useContactEditDialogContext,
} from "~/features/contact/dialog-stores";
import { useEntitlements } from "~/hooks/use-entitlements";
import {
  companyCollection,
  contactAttributeDefinitionCollection,
  contactAttributeValueCollection,
  contactCollection,
} from "~/lib/collections";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/contact/"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await Promise.all([
      contactCollection.preload(),
      contactAttributeDefinitionCollection.preload(),
      contactAttributeValueCollection.preload(),
      companyCollection.preload(),
    ]);
    return null;
  },
});

function RouteComponent() {
  return (
    <CompanyEditDialogProvider>
      <ContactCreateDialogProvider>
        <ContactEditDialogProvider>
          <ContactDeleteDialogProvider>
            <ContactPage />
            <CompanyEditDialog />
            <ContactCreateDialog />
            <ContactEditDialog />
            <ContactDeleteDialog />
          </ContactDeleteDialogProvider>
        </ContactEditDialogProvider>
      </ContactCreateDialogProvider>
    </CompanyEditDialogProvider>
  );
}

function ContactPage() {
  const { organizationId } = Route.useParams();
  const {
    companyCollection,
    contactAttributeDefinitionCollection,
    contactCollection,
  } = useDashboardCollections();
  const createDialogStore = useContactCreateDialogContext();
  const editDialogStore = useContactEditDialogContext();
  const deleteDialogStore = useContactDeleteDialogContext();
  const companyEditDialogStore = useCompanyEditDialogContext();
  const contactsQuery = useLiveQuery(
    (q) =>
      q
        .from({ contact: contactCollection })
        .where(({ contact }) => eq(contact.organizationId, organizationId))
        .orderBy(({ contact }) => contact.updatedAt, "desc"),
    [organizationId]
  );
  const contacts = contactsQuery.data ?? [];
  const { data: definitions = [] } = useLiveQuery(
    (q) =>
      q
        .from({ definition: contactAttributeDefinitionCollection })
        .where(({ definition }) =>
          eq(definition.organizationId, organizationId)
        )
        .orderBy(({ definition }) => definition.createdAt, "asc"),
    [organizationId]
  );
  const { data: companies = [] } = useLiveQuery(
    (q) =>
      q
        .from({ company: companyCollection })
        .where(({ company }) => eq(company.organizationId, organizationId)),
    [organizationId]
  );
  const companiesById = new Map(companies.map((c) => [c.id, c]));

  const { entitlements, plan } = useEntitlements();
  const crmLimit = entitlements.limits.crmEntries;
  const totalCrmEntries = contacts.length + companies.length;
  const hasReachedCrmLimit = crmLimit !== null && totalCrmEntries >= crmLimit;
  const upgradePlanStore = useUpgradePlanDialogContext();

  const openCreateDialog = () => {
    if (hasReachedCrmLimit) {
      upgradePlanStore.send({ type: "toggle" });
      return;
    }
    createDialogStore.send({ type: "toggle" });
  };

  if (!contactsQuery.isLoading && contacts.length === 0) {
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
              <HugeiconsIcon icon={UserAdd01Icon} />
            </EmptyMedia>
            <EmptyTitle>No contacts yet</EmptyTitle>
            <EmptyDescription>
              Add a contact to keep the people behind your feedback organized.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <PolicyGuard
              policy={hasPermission(organizationId, "contacts.create")}
            >
              {({ allowed }) => (
                <Button
                  disabled={!allowed || hasReachedCrmLimit}
                  onClick={openCreateDialog}
                  type="button"
                  variant="brand"
                >
                  <HugeiconsIcon icon={UserAdd01Icon} />
                  Create contact
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
        <PolicyGuard policy={hasPermission(organizationId, "contacts.create")}>
          {({ allowed }) => (
            <Button
              disabled={!allowed || hasReachedCrmLimit}
              onClick={openCreateDialog}
              type="button"
              variant="brand"
            >
              <HugeiconsIcon icon={UserAdd01Icon} />
              Create contact
            </Button>
          )}
        </PolicyGuard>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>External ID</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Company</TableHead>
            {definitions.map((definition) => (
              <TableHead key={definition.id}>{definition.name}</TableHead>
            ))}
            <TableHead>Updated</TableHead>
            <TableHead className="w-16 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((contact) => (
            <ContactTableRow
              company={
                contact.companyId
                  ? companiesById.get(contact.companyId)
                  : undefined
              }
              contact={contact}
              definitions={definitions}
              key={contact.id}
              managePolicy={hasPermission(organizationId, "contacts.*")}
              onCompanyClick={(companyId) =>
                companyEditDialogStore.send({
                  type: "toggle",
                  data: { companyId, mode: "display" },
                })
              }
              onDelete={() =>
                deleteDialogStore.send({
                  type: "toggle",
                  data: { contactId: contact.id },
                })
              }
              onEdit={() =>
                editDialogStore.send({
                  type: "toggle",
                  data: { contactId: contact.id },
                })
              }
              updatePolicy={hasPermission(organizationId, "contacts.update")}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
