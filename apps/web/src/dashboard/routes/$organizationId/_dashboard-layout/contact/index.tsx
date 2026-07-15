import { Button } from "@feeblo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@feeblo/ui/dropdown-menu";
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
  Delete02Icon,
  Edit,
  Ellipsis,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { ContactCreateDialog } from "~/features/contact/components/contact-create-dialog";
import { ContactDeleteDialog } from "~/features/contact/components/contact-delete-dialog";
import { ContactEditDialog } from "~/features/contact/components/contact-edit-dialog";
import {
  ContactCreateDialogProvider,
  ContactDeleteDialogProvider,
  ContactEditDialogProvider,
  useContactCreateDialogContext,
  useContactDeleteDialogContext,
  useContactEditDialogContext,
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
      <ContactEditDialogProvider>
        <ContactDeleteDialogProvider>
          <ContactPage />
          <ContactCreateDialog />
          <ContactEditDialog />
          <ContactDeleteDialog />
        </ContactDeleteDialogProvider>
      </ContactEditDialogProvider>
    </ContactCreateDialogProvider>
  );
}

function ContactPage() {
  const { organizationId } = Route.useParams();
  const { contactCollection } = useDashboardCollections();
  const createDialogStore = useContactCreateDialogContext();
  const editDialogStore = useContactEditDialogContext();
  const deleteDialogStore = useContactDeleteDialogContext();
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
            <TableHead className="w-16 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
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
                          Open actions for {contact.name ?? "contact"}
                        </span>
                      </Button>
                    )}
                  />
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem
                      onClick={() =>
                        editDialogStore.send({
                          type: "toggle",
                          data: { contactId: contact.id },
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
                          data: { contactId: contact.id },
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
