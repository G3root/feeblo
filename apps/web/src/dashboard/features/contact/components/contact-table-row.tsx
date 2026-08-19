import { Button } from "@feeblo/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@feeblo/ui/menu";
import { TableCell, TableRow } from "@feeblo/ui/table";
import {
  anyPolicy,
  type ClientPolicy,
  PolicyGuard,
} from "@feeblo/web-shared/use-policy";
import {
  ArrowUpRight01Icon,
  Delete02Icon,
  Edit,
  Ellipsis,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";

import {
  type CustomAttributeDefinition,
  formatCustomAttributeValue,
} from "~/features/custom-attribute/components/custom-attribute-fields";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

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

export function ContactTableRow({
  company,
  contact,
  definitions,
  managePolicy,
  onCompanyClick,
  onDelete,
  onEdit,
  updatePolicy,
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
  managePolicy: ClientPolicy;
  onCompanyClick: (companyId: string) => void;
  onDelete: () => void;
  onEdit: () => void;
  updatePolicy: ClientPolicy;
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
        <PolicyGuard policy={anyPolicy(updatePolicy, managePolicy)}>
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
                        Open actions for {contact.name ?? "contact"}
                      </span>
                    </Button>
                  )}
                />
                <MenuPopup align="end" className="w-40">
                  <PolicyGuard policy={updatePolicy}>
                    {({ allowed }) => (
                      <MenuItem disabled={!allowed} onClick={onEdit}>
                        <HugeiconsIcon
                          className="text-muted-foreground"
                          icon={Edit}
                        />
                        <span>Edit</span>
                      </MenuItem>
                    )}
                  </PolicyGuard>
                  <PolicyGuard policy={managePolicy}>
                    {({ allowed }) => (
                      <MenuItem
                        disabled={!allowed}
                        onClick={onDelete}
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
  );
}
