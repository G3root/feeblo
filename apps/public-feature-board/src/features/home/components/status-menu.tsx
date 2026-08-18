import { Button } from "@feeblo/ui/button";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@feeblo/ui/menu";
import { DashedLineCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useHome } from "../home-context";

export function HomeStatusMenu({ className }: { className?: string }) {
  const { state, actions } = useHome();
  const { selectedStatus, statusItems } = state;

  return (
    <Menu>
      <MenuTrigger
        render={(props) => (
          <Button
            {...props}
            aria-label="Filter by status"
            className={className}
            size="icon"
            variant="outline"
          >
            <HugeiconsIcon icon={DashedLineCircleIcon} />
          </Button>
        )}
      />
      <MenuPopup align="end" className="w-44">
        <MenuRadioGroup
          onValueChange={(nextValue) => {
            if (nextValue !== null) {
              actions.updateFilters({ status: nextValue });
            }
          }}
          value={selectedStatus}
        >
          {statusItems.map((item) => (
            <MenuRadioItem closeOnClick key={item.value} value={item.value}>
              {item.label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
