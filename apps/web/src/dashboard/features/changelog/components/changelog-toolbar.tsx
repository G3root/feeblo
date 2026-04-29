import { Link } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import { SkeletonWrapper } from "~/components/ui/skeleton-loader";
import { toggleVariants } from "~/components/ui/toggle";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { cn } from "~/lib/utils";
import { useChangelogAction } from "../hooks/use-changelog-action";

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
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
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

        <div>
          <Button onClick={createChangeLog}>New Entry</Button>
        </div>
      </div>
    </div>
  );
}
