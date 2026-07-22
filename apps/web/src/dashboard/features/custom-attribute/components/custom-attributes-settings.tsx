import { Badge } from "@feeblo/ui/badge";
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
import { SkeletonLoader, SkeletonWrapper } from "@feeblo/ui/skeleton-loader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@feeblo/ui/table";
import { Tabs, TabsPanel, TabsList, TabsTab } from "@feeblo/ui/tabs";
import {
  Building03Icon,
  Contact01Icon,
  Delete02Icon,
  Edit,
  Ellipsis,
  Plus,
  PropertyNewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import type { ReactNode } from "react";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import {
  type CustomAttributeEntityType,
  useCustomAttributeCreateDialogContext,
  useCustomAttributeDeleteDialogContext,
  useCustomAttributeEditDialogContext,
} from "../dialog-stores";

type AttributeDefinition = {
  id: string;
  isRequired: boolean;
  key: string;
  name: string;
  type: "TEXT" | "INTEGER" | "DECIMAL" | "BOOLEAN" | "DATE";
};

export function CustomAttributesSettings() {
  const organizationId = useOrganizationId();
  const {
    companyAttributeDefinitionCollection,
    contactAttributeDefinitionCollection,
  } = useDashboardCollections();
  const dialogStore = useCustomAttributeCreateDialogContext();
  const editDialogStore = useCustomAttributeEditDialogContext();
  const deleteDialogStore = useCustomAttributeDeleteDialogContext();

  const contactAttributesQuery = useLiveQuery(
    (query) =>
      query
        .from({ attribute: contactAttributeDefinitionCollection })
        .where(({ attribute }) => eq(attribute.organizationId, organizationId))
        .orderBy(({ attribute }) => attribute.createdAt, "asc"),
    [organizationId]
  );
  const companyAttributesQuery = useLiveQuery(
    (query) =>
      query
        .from({ attribute: companyAttributeDefinitionCollection })
        .where(({ attribute }) => eq(attribute.organizationId, organizationId))
        .orderBy(({ attribute }) => attribute.createdAt, "asc"),
    [organizationId]
  );

  const openCreateDialog = (entityType: CustomAttributeEntityType) =>
    dialogStore.send({ type: "toggle", data: { entityType } });

  const openEditDialog = (
    attributeId: string,
    entityType: CustomAttributeEntityType
  ) =>
    editDialogStore.send({ type: "toggle", data: { attributeId, entityType } });

  const openDeleteDialog = (
    attributeId: string,
    entityType: CustomAttributeEntityType
  ) =>
    deleteDialogStore.send({
      type: "toggle",
      data: { attributeId, entityType },
    });

  return (
    <Tabs defaultValue="contact">
      <TabsList>
        <TabsTab value="contact">
          <HugeiconsIcon icon={Contact01Icon} />
          Contacts
        </TabsTab>
        <TabsTab value="company">
          <HugeiconsIcon icon={Building03Icon} />
          Companies
        </TabsTab>
      </TabsList>
      <TabsPanel className="pt-4" value="contact">
        <AttributeList
          attributes={contactAttributesQuery.data}
          entityType="contact"
          isError={contactAttributesQuery.isError}
          isLoading={contactAttributesQuery.isLoading}
          onCreate={() => openCreateDialog("contact")}
          onDelete={(id) => openDeleteDialog(id, "contact")}
          onEdit={(id) => openEditDialog(id, "contact")}
        />
      </TabsPanel>
      <TabsPanel className="pt-4" value="company">
        <AttributeList
          attributes={companyAttributesQuery.data}
          entityType="company"
          isError={companyAttributesQuery.isError}
          isLoading={companyAttributesQuery.isLoading}
          onCreate={() => openCreateDialog("company")}
          onDelete={(id) => openDeleteDialog(id, "company")}
          onEdit={(id) => openEditDialog(id, "company")}
        />
      </TabsPanel>
    </Tabs>
  );
}

function AttributeList({
  attributes,
  entityType,
  isError,
  isLoading,
  onDelete,
  onEdit,
  onCreate,
}: {
  attributes: readonly AttributeDefinition[] | undefined;
  entityType: CustomAttributeEntityType;
  isError: boolean;
  isLoading: boolean;
  onDelete: (attributeId: string) => void;
  onEdit: (attributeId: string) => void;
  onCreate: () => void;
}) {
  const pluralEntity = entityType === "contact" ? "contacts" : "companies";

  if (isLoading) {
    return (
      <SkeletonLoader isLoading>
        <section className="space-y-6">
          <AttributeActions onCreate={onCreate} />
          <AttributeTable>
            {loadingRowIds.map((id) => (
              <AttributeLoadingRow key={id} />
            ))}
          </AttributeTable>
        </section>
      </SkeletonLoader>
    );
  }

  if (isError) {
    return (
      <section className="space-y-6">
        <AttributeActions onCreate={onCreate} />
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={PropertyNewIcon} />
            </EmptyMedia>
            <EmptyTitle>Unable to load attributes</EmptyTitle>
            <EmptyDescription>
              Refresh the page to try loading the {entityType} attributes again.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </section>
    );
  }

  if (!attributes || attributes.length === 0) {
    return (
      <section className="space-y-6">
        <AttributeActions onCreate={onCreate} />
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={PropertyNewIcon} />
            </EmptyMedia>
            <EmptyTitle>No {entityType} attributes yet</EmptyTitle>
            <EmptyDescription>
              Add a custom field to capture details that matter across your{" "}
              {pluralEntity}.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={onCreate} type="button">
              <HugeiconsIcon icon={Plus} />
              Create attribute
            </Button>
          </EmptyContent>
        </Empty>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <AttributeActions onCreate={onCreate} />
      <AttributeTable>
        {attributes.map((attribute) => (
          <TableRow key={attribute.id}>
            <TableCell className="font-medium">{attribute.name}</TableCell>
            <TableCell>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {attribute.key}
              </code>
            </TableCell>
            <TableCell>
              <Badge variant="secondary">{typeLabels[attribute.type]}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {attribute.isRequired ? "Required" : "Optional"}
            </TableCell>
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
                        Open actions for {attribute.name}
                      </span>
                    </Button>
                  )}
                />
                <MenuPopup align="end" className="w-40">
                  <MenuItem onClick={() => onEdit(attribute.id)}>
                    <HugeiconsIcon
                      className="text-muted-foreground"
                      icon={Edit}
                    />
                    <span>Edit</span>
                  </MenuItem>
                  <MenuItem
                    onClick={() => onDelete(attribute.id)}
                    variant="destructive"
                  >
                    <HugeiconsIcon icon={Delete02Icon} />
                    <span>Delete</span>
                  </MenuItem>
                </MenuPopup>
              </Menu>
            </TableCell>
          </TableRow>
        ))}
      </AttributeTable>
    </section>
  );
}

function AttributeActions({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex justify-end">
      <SkeletonWrapper>
        <Button onClick={onCreate} type="button">
          <HugeiconsIcon icon={Plus} />
          New attribute
        </Button>
      </SkeletonWrapper>
    </div>
  );
}

function AttributeTable({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Requirement</TableHead>
            <TableHead className="w-16 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}

function AttributeLoadingRow() {
  return (
    <TableRow>
      <TableCell>Loading attribute</TableCell>
      <TableCell>attribute_key</TableCell>
      <TableCell>Text</TableCell>
      <TableCell>Optional</TableCell>
      <TableCell className="text-right">
        <Button size="icon-sm" type="button" variant="ghost">
          <HugeiconsIcon icon={Ellipsis} />
          <span className="sr-only">Open actions</span>
        </Button>
      </TableCell>
    </TableRow>
  );
}

const loadingRowIds = ["attribute-loading-1", "attribute-loading-2"];

const typeLabels = {
  BOOLEAN: "Yes / no",
  DATE: "Date",
  DECIMAL: "Decimal",
  INTEGER: "Integer",
  TEXT: "Text",
} as const;
