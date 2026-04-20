import { Link } from "@tanstack/react-router";
import { toggleVariants } from "~/components/ui/toggle";
import { cn } from "~/lib/utils";

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

export function ChangelogToolbar({
  organizationId,
}: {
  organizationId: string;
}) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {links.map((link) => (
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
          ))}
        </div>
      </div>
    </div>
  );
}
