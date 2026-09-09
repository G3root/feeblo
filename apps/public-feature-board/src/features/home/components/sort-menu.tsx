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

import { m } from "../../../paraglide/messages.js";
import { useHome } from "../home-context";
import { getSortItems } from "./sort-options";

export function HomeSortMenu({ className }: { className?: string }) {
  const { state, actions } = useHome();
  const { sortBy } = state;
  const sortItems = getSortItems();

  return (
    <Menu>
      <MenuTrigger
        render={(props) => (
          <Button
            {...props}
            aria-label={m.fancy_solid_husky()}
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
          {sortItems.map((item) => (
            <MenuRadioItem closeOnClick key={item.value} value={item.value}>
              {item.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
