import { Button } from "@feeblo/ui/button";
import {
  Menu,
  MenuPopup,
  MenuItem,
  MenuTrigger,
} from "@feeblo/ui/menu";
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
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@feeblo/ui/table";
import {
  ArrowUpRight01Icon,
  Delete02Icon,
  Edit,
  Ellipsis,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { CompanyEditDialog } from "~/features/contact/components/company-edit-dialog";
import { ContactCreateDialog } from "~/features/contact/components/contact-create-dialog";
import { ContactDeleteDialog } from "~/features/contact/components/contact-delete-dialog";
import { ContactEditDialog } from "~/features/contact/components/contact-edit-dialog";
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
import {
  type CustomAttributeDefinition,
  formatCustomAttributeValue,
} from "~/features/custom-attribute/components/custom-attribute-fields";
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

  const openCreateDialog = () => createDialogStore.send({ type: "toggle" });

  if (!contactsQuery.isLoading && contacts.length === 0) {
    return (
      <div className="p-3">
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
            <Button onClick={openCreateDialog} type="button">
              <HugeiconsIcon icon={UserAdd01Icon} />
              Create contact
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
          <HugeiconsIcon icon={UserAdd01Icon} />
          Create contact
        </Button>
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
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ContactTableRow({
  company,
  contact,
  definitions,
  onCompanyClick,
  onDelete,
  onEdit,
}: {
  company?: { id: string; name: string };
  contact: {
    companyId: string | null;
    email: string | null;
    externalId: string | null;
    id: string;
    name: string | null;
    phone: string | null;
    source: "DASHBOARD" | "WIDGET" | "API" | "IMPORT";
    updatedAt: Date;
  };
  definitions: readonly CustomAttributeDefinition[];
  onCompanyClick: (companyId: string) => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const { contactAttributeValueCollection } = useDashboardCollections();
  const { data: values = [] } = useLiveQuery(
    (q) =>
      q
        .from({ value: contactAttributeValueCollection })
        .where(({ value }) => eq(value.contactId, contact.id)),
    [contact.id]
  );
  const valuesByAttributeId = new Map(
    values.map((value) => [value.attributeId, value])
  );

  return (
    <TableRow>
      <TableCell className="font-medium">
        {contact.name ?? "Unnamed contact"}
      </TableCell>
      <TableCell>{contact.email ?? "—"}</TableCell>
      <TableCell>{contact.phone ?? "—"}</TableCell>
      <TableCell>{contact.externalId ?? "—"}</TableCell>
      <TableCell>{formatSource(contact.source)}</TableCell>
      <TableCell>
        {company ? (
          <Button
            onClick={() => onCompanyClick(company.id)}
            type="button"
            variant="link"
          >
            {company.name} <HugeiconsIcon icon={ArrowUpRight01Icon} />
          </Button>
        ) : (
          "—"
        )}
      </TableCell>
      {definitions.map((definition) => (
        <TableCell key={definition.id}>
          {formatCustomAttributeValue(valuesByAttributeId.get(definition.id))}
        </TableCell>
      ))}
      <TableCell>{formatDate(contact.updatedAt)}</TableCell>
      <TableCell className="text-right">
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
                  Open actions for {contact.name ?? "contact"}
                </span>
              </Button>
            )}
          />
          <MenuPopup align="end" className="w-40">
            <MenuItem onClick={onEdit}>
              <HugeiconsIcon className="text-muted-foreground" icon={Edit} />
              <span>Edit</span>
            </MenuItem>
            <MenuItem onClick={onDelete} variant="destructive">
              <HugeiconsIcon icon={Delete02Icon} />
              <span>Delete</span>
            </MenuItem>
          </MenuPopup>
        </Menu>
      </TableCell>
    </TableRow>
  );
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}

function formatSource(source: "DASHBOARD" | "WIDGET" | "API" | "IMPORT") {
  return {
    DASHBOARD: "Dashboard",
    WIDGET: "Widget",
    API: "API",
    IMPORT: "Import",
  }[source];
}
