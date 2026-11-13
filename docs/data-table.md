# Data table

The dashboard's table kit lives in `packages/ui/src/data-table` and is imported as `@feeblo/ui/data-table`. It is a port of the diceui `@diceui/data-table` family: same feature set (multi-column sorting, a filter builder, pagination, row selection, column visibility, an actions column), rebuilt on this repository's primitives. The CRM contact list (`apps/web/src/dashboard/features/contact/components/contact-table.tsx`) is the first consumer; a page that needs a table adds a consumer of this one rather than a second table.

## What it is built from

| diceui ships | This port uses |
| --- | --- |
| `nuqs` for URL state | TanStack Router `useLocation`/`useNavigate` |
| shadcn Radix `dropdown-menu` | coss `Menu` (`Menu`, `MenuTrigger`, `MenuPopup`, `MenuCheckboxItem`) |
| shadcn `select`/`popover` | coss `Select`/`Popover` (`SelectPopup`, `PopoverPopup`) |
| the `faceted` command palette (`cmdk`) | coss `Popover` + `DataTableOptionList` |
| legacy `@dnd-kit/core`/`sortable`/`modifiers`/`utilities` | `@dnd-kit/react` (already a dependency of `apps/web`) |
| `date-fns`, `radix-ui`, `@base-ui/utils` | nothing — dates use `Intl`, direction comes from `@base-ui/react` |

The only new dependency is `@tanstack/react-table` v9, pinned in the catalog. `nuqs`, `cmdk`, `date-fns` and the legacy dnd-kit packages are deliberately **not** dependencies: each was serving a library the port replaces with one already installed.

`DataTableCommandFilterMenu` is not a line-for-line port. diceui's version is a ~1,000-line keyboard state machine over an inline command palette; this one is an inline filter bar whose "add" step is a type-to-find field list, sharing the same row editor as `DataTableFilterMenu`. Same capability — search a field by name, pick it, fill in the condition — without a second keyboard protocol to maintain.

## URL state

The table keeps its state in the route's search params, which is what `useDataTable` owns. The keys are flat, optionally namespaced by the config's `id`:

| Key | Shape |
| --- | --- |
| `page` | `1`-based integer, omitted at `1` |
| `perPage` | integer, omitted at the config default |
| `sort` | `name.asc,points.desc`; ids are percent-encoded so a comma or dot survives |
| `joinOperator` | `and` or `or`, omitted at `and` |
| `search` | the global filter, omitted when empty |
| one key per filterable column | repeated values, e.g. `?status=active&status=in.invited` |

A filter value is `operator.value` when the operator is not the plain one for its variant (`in.active`, `not.in.invited`, `between.1,50`, `is.empty`), and the bare value otherwise (`?name=ada`). That keeps the common URL short and the round trip lossless; `config.parse` reads it and `config.apply` writes it.

`useDataTable` reads `location.search` rather than `useSearch()`. A route's `validateSearch` schema does not have to know the table's keys, and a schema that strips unknown keys cannot strip them — but a route that wants a loader to re-run on a filter change declares that in `loaderDeps`, because that is the router's own contract.

Writes are merged into the record the table read, so a `?tab=` or a board slug survives a filter change, and a key whose value is the default is deleted rather than written. The state renders optimistically: a write is applied locally and the URL is written on the trailing edge of a 300 ms debounce (`debounceMs`), which is nuqs' `limitUrlUpdates` in router terms. `replace` defaults to `true` and `resetScroll` to `false`.

## Using it

```tsx
const config = createDataTableConfig({
  columns: {
    name: { variant: "text" },
    status: { variant: "select" },
    createdAt: { variant: "date" },
  },
  defaultSorting: [{ id: "name", desc: false }],
});

function PostsTable({ posts }: { posts: Post[] }) {
  const { table } = useDataTable({
    columns,
    config,
    data: posts,
    mode: "client",
  });

  return (
    <DataTable table={table}>
      <DataTableToolbar globalFilterPlaceholder="Search posts…" table={table}>
        <DataTableFilterMenu table={table} />
        <DataTableSortMenu table={table} />
      </DataTableToolbar>
    </DataTable>
  );
}
```

`mode: "server"` takes `pageCount` instead of `data` and turns on manual sorting, filtering and pagination; the caller then reads `config.parse(location.search)` (or the same query from `useDataTable`, via the table's state) and fetches that page. Column metadata (`meta.label`, `meta.variant`, `meta.options`, `meta.min`/`max`/`unit`) drives which filter control the toolbar renders, and `getDataTableSelectColumn`/`getDataTableActionsColumn` supply the leading and trailing columns.

The table must render inside a route: `useDataTable` requires the router's location and navigate. That is the one thing it cannot do outside TanStack Router, and the reason it is exported as a router-aware hook rather than a presentational component.
