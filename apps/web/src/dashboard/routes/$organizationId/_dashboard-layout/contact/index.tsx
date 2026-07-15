import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@feeblo/ui/table";
import { UserAdd01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { ContactCreateDialog } from "~/features/contact/components/contact-create-dialog";
import {
  ContactCreateDialogProvider,
  useContactCreateDialogContext,
} from "~/features/contact/dialog-stores";
import { contactCollection } from "~/lib/collections";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/contact/"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await contactCollection.preload();
    return null;
  },
});

function RouteComponent() {
  return (
    <ContactCreateDialogProvider>
      <ContactPage />
      <ContactCreateDialog />
    </ContactCreateDialogProvider>
  );
}

function ContactPage() {
  const { organizationId } = Route.useParams();
  const { contactCollection } = useDashboardCollections();
  const createDialogStore = useContactCreateDialogContext();
  const contactsQuery = useLiveQuery(
    (q) =>
      q
        .from({ contact: contactCollection })
        .where(({ contact }) => eq(contact.organizationId, organizationId))
        .orderBy(({ contact }) => contact.updatedAt, "desc"),
    [organizationId]
  );
  const contacts = contactsQuery.data ?? [];

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
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((contact) => (
            <TableRow key={contact.id}>
              <TableCell className="font-medium">
                {contact.name ?? "Unnamed contact"}
              </TableCell>
              <TableCell>{contact.email ?? "—"}</TableCell>
              <TableCell>{contact.phone ?? "—"}</TableCell>
              <TableCell>{formatDate(contact.updatedAt)}</TableCell>
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
