import { DebouncedInputGroupInput } from "@feeblo/ui/debounced-input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
} from "@feeblo/ui/input-group";
import { cn } from "@feeblo/ui/utils";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useHome } from "../home-context";

export function HomeSearchInput() {
  const { state, actions } = useHome();
  const { search, searchFocused } = state;

  return (
    <div
      className={cn(
        "w-full transition-[max-width] duration-300 ease-out",
        searchFocused ? "max-w-full" : "max-w-9 sm:max-w-40"
      )}
    >
      <InputGroup className="h-9 sm:h-8">
        <InputGroupAddon>
          <InputGroupText>
            <HugeiconsIcon icon={Search01Icon} />
          </InputGroupText>
        </InputGroupAddon>
        <DebouncedInputGroupInput
          aria-label="Search feedback"
          onBlur={() => actions.setSearchFocused(false)}
          onChange={actions.setSearch}
          onFocus={() => actions.setSearchFocused(true)}
          placeholder="Search feedback"
          value={search}
        />
      </InputGroup>
    </div>
  );
}
