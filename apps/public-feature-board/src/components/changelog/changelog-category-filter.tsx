import { Button } from "@feeblo/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuPopup,
  MenuPortal,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "@feeblo/ui/menu";
import { FilterMailIcon, Tag01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";

import { useChangelogFilterStore } from "../../lib/changelog-filter-store";
import { usePublicCollections } from "../../providers/public-collections-provider";
import { useSite } from "../../providers/site-provider";

export function ChangelogCategoryFilter() {
  const site = useSite();
  const { publicChangelogCategoryCollection } = usePublicCollections();
  const store = useChangelogFilterStore();
  const selectedCategoryIds = useSelector(
    store,
    (state) => state.context.selectedCategoryIds
  );

  const { data: categories = [] } = useLiveQuery(
    (q) =>
      q
        .from({ category: publicChangelogCategoryCollection })
        .where(({ category }) =>
          eq(category.organizationId, site.organizationId)
        )
        .orderBy(({ category }) => category.name, "asc"),
    [site.organizationId]
  );

  const selectedCategorySet = new Set(selectedCategoryIds);

  if (categories.length === 0) {
    return null;
  }

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button className="rounded-full" size="icon-sm" variant="outline">
            <HugeiconsIcon icon={FilterMailIcon} />
          </Button>
        }
      />
      <MenuPopup className="w-44">
        <MenuGroup>
          <MenuSub>
            <MenuSubTrigger>
              <HugeiconsIcon icon={Tag01Icon} />
              Categories
            </MenuSubTrigger>
            <MenuPortal>
              <MenuSubPopup>
                {categories.map((category) => (
                  <MenuCheckboxItem
                    checked={selectedCategorySet.has(category.id)}
                    key={category.id}
                    onCheckedChange={() => {
                      store.send({
                        type: "toggleCategory",
                        categoryId: category.id,
                      });
                    }}
                  >
                    {category.name}
                  </MenuCheckboxItem>
                ))}
              </MenuSubPopup>
            </MenuPortal>
          </MenuSub>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
