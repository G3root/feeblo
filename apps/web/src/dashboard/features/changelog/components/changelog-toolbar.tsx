import { Button } from "@feeblo/ui/button";
import { DebouncedInputGroupInput } from "@feeblo/ui/debounced-input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
} from "@feeblo/ui/input-group";
import { SkeletonWrapper } from "@feeblo/ui/skeleton-loader";
import { toggleVariants } from "@feeblo/ui/toggle";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { cn } from "@feeblo/ui/utils";
import { useChangelogAction } from "../hooks/use-changelog-action";
import { useChangelogStore } from "../state/changelog-store-context";

const links = [
  {
    name: "All changelogs",
    to: "/$organizationId/changelog" as const,
  },
  {
    name: "Draft",
    to: "/$organizationId/changelog/draft" as const,
  },
  {
    name: "Published",
    to: "/$organizationId/changelog/published" as const,
  },
];

export function ChangelogToolbar() {
  const organizationId = useOrganizationId();
  const { createChangeLog } = useChangelogAction();
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {links.map((link) => (
            <SkeletonWrapper key={link.to}>
              <Link
                activeOptions={{
                  exact: true,
                }}
                activeProps={{
                  "data-active": "true",
                }}
                className={cn(
                  toggleVariants({
                    variant: "outline",
                    size: "sm",
                  }),
                  "h-7 min-w-7 data-active:bg-muted"
                )}
                key={link.to}
                params={{ organizationId }}
                to={link.to}
              >
                {link.name}
              </Link>
            </SkeletonWrapper>
          ))}
        </div>

        <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
          <div className="w-full sm:w-72">
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>
                  <HugeiconsIcon icon={Search01Icon} />
                </InputGroupText>
              </InputGroupAddon>
              <DebouncedSearch />
            </InputGroup>
          </div>
          <Button onClick={createChangeLog}>New Entry</Button>
        </div>
      </div>
    </div>
  );
}

function DebouncedSearch() {
  const store = useChangelogStore();
  const search = useSelector(store, (s) => s.context.filters.search);
  return (
    <DebouncedInputGroupInput
      aria-label="Search changelog titles"
      onChange={(value) => {
        store.send({ type: "setSearch", value });
      }}
      placeholder="Search changelog titles"
      value={search}
    />
  );
}
