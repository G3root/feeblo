import { Button } from "@feeblo/ui/button";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@feeblo/ui/menu";
import { Sorting01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useHome } from "../home-context";
import { SORT_ITEMS } from "./sort-options";

export function HomeSortMenu({ className }: { className?: string }) {
  const { state, actions } = useHome();
  const { sortBy } = state;

  return (
    <Menu>
      <MenuTrigger
        render={(props) => (
          <Button
            {...props}
            aria-label="Sort feedback"
            className={className}
            size="icon"
            variant="outline"
          >
            <HugeiconsIcon icon={Sorting01Icon} />
          </Button>
        )}
      />
      <MenuPopup align="end" className="w-40">
        <MenuRadioGroup
          onValueChange={(nextValue) => {
            if (nextValue !== null) {
              actions.updateFilters({ sort: nextValue });
            }
          }}
          value={sortBy}
        >
          {SORT_ITEMS.map((item) => (
            <MenuRadioItem closeOnClick key={item.value} value={item.value}>
              {item.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
