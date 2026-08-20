import { createStoreContext } from "@feeblo/web-shared/xstate";
import { createStore } from "@xstate/store";
import { useSelector } from "@xstate/store-react";

type ChangelogFilterContext = {
  search: string;
  selectedCategoryIds: string[];
};

type ChangelogFilterDefaultValue = {
  search?: string;
  selectedCategoryIds?: string[];
};

const createChangelogFilterStore = (
  defaultValue?: ChangelogFilterDefaultValue
) =>
  createStore({
    // SAFETY: All fields are provided with defaults matching ChangelogFilterContext shape.
    context: {
      search: defaultValue?.search ?? "",
      selectedCategoryIds: defaultValue?.selectedCategoryIds ?? [],
    } as ChangelogFilterContext,
    on: {
      setSearch: (context, event: { value: string }) => ({
        ...context,
        search: event.value,
      }),
      toggleCategory: (context, event: { categoryId: string }) => {
        const selected = new Set(context.selectedCategoryIds);

        if (selected.has(event.categoryId)) {
          selected.delete(event.categoryId);
        } else {
          selected.add(event.categoryId);
        }

        return {
          ...context,
          selectedCategoryIds: [...selected],
        };
      },
      clearCategories: (context) => ({
        ...context,
        selectedCategoryIds: [],
      }),
      clearAll: (context) => ({
        ...context,
        search: "",
        selectedCategoryIds: [],
      }),
    },
  });

export const [ChangelogFilterProvider, useChangelogFilterStore] =
  createStoreContext<
    ReturnType<typeof createChangelogFilterStore>,
    ChangelogFilterDefaultValue
  >({
    createStore: createChangelogFilterStore,
    hookName: "useChangelogFilterStore",
    name: "ChangelogFilterStoreContext",
    providerName: "ChangelogFilterProvider",
  });
