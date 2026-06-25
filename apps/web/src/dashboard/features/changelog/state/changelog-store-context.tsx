import { createStore } from "@xstate/store";
import { createStoreContext } from "~/lib/xstate";
import type { ChangelogStatus } from "../constants";

export type ChangelogFilters = {
  search: string;
  statuses: ChangelogStatus[];
};

type ChangelogStoreContext = {
  filters: ChangelogFilters;
};

export type ChangelogStoreDefaultValue = {
  filters?: Partial<ChangelogFilters>;
};

const createChangelogStore = (defaultValue?: ChangelogStoreDefaultValue) =>
  createStore({
    context: {
      filters: {
        search: defaultValue?.filters?.search ?? "",
        statuses: defaultValue?.filters?.statuses ?? [],
      },
    } as ChangelogStoreContext,
    on: {
      clearFilters: (context) => ({
        ...context,
        filters: {
          ...context.filters,
          search: "",
        },
      }),
      setSearch: (context, event: { value: string }) => ({
        ...context,
        filters: {
          ...context.filters,
          search: event.value,
        },
      }),
      setStatuses: (context, event: { statuses: ChangelogStatus[] }) => ({
        ...context,
        filters: {
          ...context.filters,
          statuses: event.statuses,
        },
      }),
    },
  });

export const [ChangelogStoreProvider, useChangelogStore] = createStoreContext<
  ReturnType<typeof createChangelogStore>,
  ChangelogStoreDefaultValue
>({
  createStore: createChangelogStore,
  hookName: "useChangelogStore",
  name: "ChangelogStoreContext",
  providerName: "ChangelogStoreProvider",
});
