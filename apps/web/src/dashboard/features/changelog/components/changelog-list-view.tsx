import { Link } from "@tanstack/react-router";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "~/components/ui/item";
import type { ChangelogStatus } from "../constants";
import { ChangelogStatusBadge } from "./changelog-status";

type TChangelogListItem = {
  id: string;
  title: string;
  slug: string;
  content: string;
  status: ChangelogStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  updatedAt: Date;
  user: {
    name: string | null;
  };
};

export function ChangelogListView({
  changelogs,
  organizationId,
}: {
  changelogs: TChangelogListItem[];
  organizationId: string;
}) {
  return (
    <div className="flex flex-col p-3">
      <ItemGroup className="gap-1">
        {changelogs.map((changelog) => (
          <Item
            className="rounded-xl"
            key={changelog.id}
            render={
              <Link
                params={{ organizationId, changelogSlug: changelog.slug }}
                to="/$organizationId/changelog/edit/$changelogSlug"
              >
                <ItemContent>
                  <ItemTitle>{changelog.title}</ItemTitle>
                  <ItemDescription>{changelog.user.name}</ItemDescription>
                </ItemContent>
                <ItemContent className="flex-none text-center">
                  <ChangelogStatusBadge status={changelog.status} />
                </ItemContent>
              </Link>
            }
            variant="default"
          />
        ))}
      </ItemGroup>
    </div>
  );
}
