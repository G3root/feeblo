import type { TCompany } from "@feeblo/domain/company/schema";
import type {
  TContact,
  TContactAccountKind,
  TContactNotifyAccess,
  TContactWithAccount,
} from "@feeblo/domain/contact/schema";
import { Button } from "@feeblo/ui/button";
import type {
  ColumnSelectOption,
  DataTableColumnConfigs,
  DataTableFeatures,
} from "@feeblo/ui/data-table";
import {
  createDataTableConfig,
  DataTable,
  DataTableColumnHeader,
  DataTableFilterMenu,
  DataTableSortMenu,
  DataTableToolbar,
  getDataTableActionsColumn,
  useDataTable,
} from "@feeblo/ui/data-table";
import { MenuItem } from "@feeblo/ui/menu";
import { Skeleton } from "@feeblo/ui/skeleton";
import {
  anyPolicy,
  hasPermission,
  PolicyGuard,
} from "@feeblo/web-shared/use-policy";
import {
  Alert02Icon,
  ArrowUpRight01Icon,
  BellOffIcon,
  Delete02Icon,
  Edit,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ColumnDef } from "@tanstack/react-table";
import * as React from "react";

import type { CustomAttributeDefinition } from "~/features/custom-attribute/components/custom-attribute-fields";
import {
  type CustomAttributeValue,
  formatCustomAttributeValue,
} from "~/features/custom-attribute/components/custom-attribute-fields";
import { useOrgContactAttributeValues } from "~/hooks/use-org-contact-attribute-values";

import {
  useCompanyEditDialogContext,
  useContactDeleteDialogContext,
  useContactEditDialogContext,
  useContactUnsubscribeDialogContext,
} from "../dialog-stores";

/**
 * The contact plus the derived value the table sorts and filters on.
 *
 * The company name is folded into the row rather than read from a map in the
 * accessor: the table caches its sorted and filtered row models on the row
 * data, so a company rename has to arrive as new row data or the cached order
 * and filter results keep the old name.
 */
type ContactRow = TContactWithAccount & { companyName: string };

const mediumDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});

const NO_ACCOUNT_LABEL = "No account";

const accountKindLabel = {
  ACCOUNT: "Account",
  MEMBER: "Workspace member",
  PORTAL: "Portal account",
  SHADOW: "On-behalf only",
} satisfies Record<TContactAccountKind, string>;

const sourceLabel = {
  API: "API",
  DASHBOARD: "Dashboard",
  IMPORT: "Import",
  ON_BEHALF: "On behalf",
  WIDGET: "Widget",
} satisfies Record<TContact["source"], string>;

const accountOptions: ColumnSelectOption[] = [
  ...Object.values(accountKindLabel),
  NO_ACCOUNT_LABEL,
].map((label) => ({ label, value: label }));

const sourceOptions: ColumnSelectOption[] = Object.values(sourceLabel).map(
  (label) => ({ label, value: label })
);

// The column config is the table's whitelist: a column absent from it renders
// but cannot be sorted or filtered. Attribute columns are absent on purpose —
// their values are fetched separately and are not part of the row.
const columnConfig = {
  account: { enableSorting: true, variant: "select" },
  company: { enableSorting: true, variant: "select" },
  email: { enableSorting: true, variant: "text" },
  externalId: { enableSorting: true, variant: "text" },
  name: { enableSorting: true, variant: "text" },
  phone: { enableSorting: true, variant: "text" },
  source: { enableSorting: true, variant: "select" },
  updatedAt: { enableSorting: true, variant: "date" },
} satisfies DataTableColumnConfigs;

const dataTableConfig = createDataTableConfig({
  columns: columnConfig,
  defaultPageSize: 20,
  defaultSorting: [{ desc: true, id: "updatedAt" }],
});

interface ContactTableProps {
  contacts: readonly TContactWithAccount[];
  companies: readonly TCompany[];
  definitions: readonly CustomAttributeDefinition[];
  organizationId: string;
}

/**
 * The CRM contact list.
 *
 * Sorting, filtering and paging belong to the table and are kept in the URL, so
 * a filtered view can be linked to. The account state and the custom attributes
 * stay derived on the server (see `ListContacts`), which is why the account
 * column filters on its *label*: the value the row carries is the thing a person
 * can search for.
 */
export function ContactTable({
  contacts,
  companies,
  definitions,
  organizationId,
}: ContactTableProps) {
  const editDialogStore = useContactEditDialogContext();
  const deleteDialogStore = useContactDeleteDialogContext();
  const unsubscribeDialogStore = useContactUnsubscribeDialogContext();
  const companyEditDialogStore = useCompanyEditDialogContext();

  const companiesById = React.useMemo(
    () => new Map(companies.map((company) => [company.id, company])),
    [companies]
  );
  const companyOptions = React.useMemo(
    () =>
      companies
        .map((company) => ({ label: company.name, value: company.name }))
        .toSorted((left, right) => left.label.localeCompare(right.label)),
    [companies]
  );

  const rows = React.useMemo<ContactRow[]>(
    () =>
      contacts.map((contact) => ({
        ...contact,
        companyName:
          contact.companyId === null
            ? ""
            : (companiesById.get(contact.companyId)?.name ?? ""),
      })),
    [companiesById, contacts]
  );

  const attributeValues = useOrgContactAttributeValues(organizationId);
  const attributeValueState = React.useMemo<ContactAttributeValuesState>(() => {
    const byContact = new Map<string, Map<string, CustomAttributeValue>>();

    for (const value of attributeValues.data) {
      const values =
        byContact.get(value.contactId) ??
        new Map<string, CustomAttributeValue>();
      values.set(value.attributeId, value);
      byContact.set(value.contactId, values);
    }

    return {
      byContact,
      isError: attributeValues.isLoadingError,
      isLoading: attributeValues.isLoading,
    };
  }, [
    attributeValues.data,
    attributeValues.isLoading,
    attributeValues.isLoadingError,
  ]);

  const columns = React.useMemo<
    ColumnDef<DataTableFeatures, ContactRow>[]
  >(() => {
    const updatePolicy = hasPermission(organizationId, "contacts.update");
    const managePolicy = hasPermission(organizationId, "contacts.*");

    return [
      {
        accessorFn: (row) => row.name ?? "",
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.name ?? "Unnamed contact"}
          </span>
        ),
        header: ({ column }) => (
          <DataTableColumnHeader column={column} label="Name" />
        ),
        id: "name",
        meta: {
          label: "Name",
          placeholder: "Filter by name…",
          variant: "text",
        },
        size: 200,
      },
      {
        accessorFn: (row) => row.email ?? "",
        cell: ({ row }) => row.original.email ?? "—",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} label="Email" />
        ),
        id: "email",
        meta: {
          label: "Email",
          placeholder: "Filter by email…",
          variant: "text",
        },
        size: 240,
      },
      {
        accessorFn: (row) =>
          row.accountKind
            ? accountKindLabel[row.accountKind]
            : NO_ACCOUNT_LABEL,
        cell: ({ row }) => (
          <AccountStatus
            accountKind={row.original.accountKind}
            notifyAccess={row.original.notifyAccess}
          />
        ),
        header: ({ column }) => (
          <DataTableColumnHeader column={column} label="Account" />
        ),
        id: "account",
        meta: {
          label: "Account",
          options: accountOptions,
          variant: "select",
        },
        size: 180,
      },
      {
        accessorFn: (row) => row.phone ?? "",
        cell: ({ row }) => row.original.phone ?? "—",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} label="Phone" />
        ),
        id: "phone",
        meta: {
          label: "Phone",
          placeholder: "Filter by phone…",
          variant: "text",
        },
        size: 150,
      },
      {
        accessorFn: (row) => row.externalId ?? "",
        cell: ({ row }) => row.original.externalId ?? "—",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} label="External ID" />
        ),
        id: "externalId",
        meta: {
          label: "External ID",
          placeholder: "Filter by external ID…",
          variant: "text",
        },
        size: 160,
      },
      {
        accessorFn: (row) => sourceLabel[row.source],
        cell: ({ row }) => sourceLabel[row.original.source],
        header: ({ column }) => (
          <DataTableColumnHeader column={column} label="Source" />
        ),
        id: "source",
        meta: { label: "Source", options: sourceOptions, variant: "select" },
        size: 130,
      },
      {
        accessorFn: (row) => row.companyName,
        cell: ({ row }) => {
          const companyId = row.original.companyId;

          if (companyId === null || row.original.companyName === "") {
            return "—";
          }

          return (
            <Button
              onClick={() =>
                companyEditDialogStore.send({
                  data: { companyId, mode: "display" },
                  type: "toggle",
                })
              }
              type="button"
              variant="link"
            >
              {row.original.companyName}
              <HugeiconsIcon icon={ArrowUpRight01Icon} />
            </Button>
          );
        },
        header: ({ column }) => (
          <DataTableColumnHeader column={column} label="Company" />
        ),
        id: "company",
        meta: {
          label: "Company",
          options: companyOptions,
          variant: "select",
        },
        size: 180,
      },
      ...definitions.map(
        (definition): ColumnDef<DataTableFeatures, ContactRow> => ({
          cell: ({ row }) => (
            <ContactAttributeCell
              attributeId={definition.id}
              contactId={row.original.id}
            />
          ),
          enableGlobalFilter: false,
          header: definition.name,
          id: `attribute:${definition.id}`,
          size: 160,
        })
      ),
      {
        accessorFn: (row) => row.updatedAt,
        cell: ({ row }) => mediumDateFormatter.format(row.original.updatedAt),
        header: ({ column }) => (
          <DataTableColumnHeader column={column} label="Updated" />
        ),
        id: "updatedAt",
        meta: { label: "Updated", variant: "date" },
        size: 150,
      },
      getDataTableActionsColumn<ContactRow>({
        actions: ({ row }) => (
          <ContactRowActions
            contact={row.original}
            managePolicy={managePolicy}
            onDelete={() =>
              deleteDialogStore.send({
                data: { contactId: row.original.id },
                type: "toggle",
              })
            }
            onEdit={() =>
              editDialogStore.send({
                data: { contactId: row.original.id },
                type: "toggle",
              })
            }
            onUnsubscribe={() =>
              unsubscribeDialogStore.send({
                data: { contactId: row.original.id },
                type: "toggle",
              })
            }
            updatePolicy={updatePolicy}
          />
        ),
        getAriaLabel: (row) =>
          `Open actions for ${row.original.name ?? "contact"}`,
      }),
    ];
  }, [
    companyOptions,
    companyEditDialogStore,
    definitions,
    deleteDialogStore,
    editDialogStore,
    organizationId,
    unsubscribeDialogStore,
  ]);

  const { table } = useDataTable({
    columns,
    config: dataTableConfig,
    data: rows,
    getRowId: (row) => row.id,
    mode: "client",
  });

  return (
    <ContactAttributeValuesProvider value={attributeValueState}>
      <DataTable table={table}>
        <DataTableToolbar
          globalFilterPlaceholder="Search contacts…"
          table={table}
        >
          <DataTableFilterMenu table={table} />
          <DataTableSortMenu table={table} />
        </DataTableToolbar>
      </DataTable>
    </ContactAttributeValuesProvider>
  );
}

interface ContactAttributeValuesState {
  byContact: ReadonlyMap<string, ReadonlyMap<string, CustomAttributeValue>>;
  /** The first load is still in flight; nothing is known yet. */
  isLoading: boolean;
  /** The first load failed; there is nothing to show. */
  isError: boolean;
}

const ContactAttributeValuesContext =
  React.createContext<ContactAttributeValuesState | null>(null);

function ContactAttributeValuesProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: ContactAttributeValuesState;
}) {
  return (
    <ContactAttributeValuesContext value={value}>
      {children}
    </ContactAttributeValuesContext>
  );
}

/**
 * One attribute value cell.
 *
 * "—" is reserved for a load that succeeded and has no value for this contact:
 * showing it while the query is still running would claim the attribute is
 * empty, and showing it on failure would hide that the value could not be read.
 */
function ContactAttributeCell({
  attributeId,
  contactId,
}: {
  attributeId: string;
  contactId: string;
}) {
  const state = React.use(ContactAttributeValuesContext);

  if (state?.isError) {
    return (
      <HugeiconsIcon
        aria-label="Attribute values could not be loaded"
        className="text-destructive size-4"
        icon={Alert02Icon}
      />
    );
  }

  if (state?.isLoading) {
    return <Skeleton className="h-4 w-16" />;
  }

  return (
    <>
      {formatCustomAttributeValue(
        state?.byContact.get(contactId)?.get(attributeId)
      )}
    </>
  );
}

/**
 * The account state column: what the person is in Feeblo, and whether post
 * updates can reach them. Both come from the server, which derives them from
 * the same eligibility rule the delivery gate uses, so the CRM cannot claim
 * someone "will be notified" when the gate would skip them.
 */
function AccountStatus({
  accountKind,
  notifyAccess,
}: {
  accountKind?: TContactAccountKind | null;
  notifyAccess?: TContactNotifyAccess;
}) {
  const label = accountKind ? accountKindLabel[accountKind] : NO_ACCOUNT_LABEL;
  const hint =
    accountKind === "SHADOW"
      ? "Cannot sign in"
      : notifyAccess === "NO"
        ? // No account, or an account whose email is unverified: attribution
          // without delivery is exactly what the reader needs to know.
          "Won't be notified"
        : notifyAccess === "PUBLIC_ONLY"
          ? "Notified on public boards only"
          : null;

  return (
    <div className="flex flex-col gap-0.5">
      <span>{label}</span>
      {hint ? (
        <span className="text-muted-foreground text-xs">{hint}</span>
      ) : null}
    </div>
  );
}

interface ContactRowActionsProps {
  contact: ContactRow;
  managePolicy: ReturnType<typeof hasPermission>;
  updatePolicy: ReturnType<typeof hasPermission>;
  onDelete: () => void;
  onEdit: () => void;
  onUnsubscribe: () => void;
}

function ContactRowActions({
  contact,
  managePolicy,
  updatePolicy,
  onDelete,
  onEdit,
  onUnsubscribe,
}: ContactRowActionsProps) {
  return (
    <PolicyGuard policy={anyPolicy(updatePolicy, managePolicy)}>
      {({ allowed: canUseAnyAction }) =>
        canUseAnyAction ? (
          <>
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
            <PolicyGuard policy={updatePolicy}>
              {({ allowed }) => (
                <MenuItem
                  // A contact without an address holds no email
                  // subscription, so there is nothing to withdraw.
                  disabled={!allowed || contact.email === null}
                  onClick={onUnsubscribe}
                >
                  <HugeiconsIcon icon={BellOffIcon} />
                  <span>Stop email updates</span>
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
          </>
        ) : null
      }
    </PolicyGuard>
  );
}
