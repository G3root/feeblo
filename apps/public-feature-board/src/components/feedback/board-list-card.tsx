import { TablerIcon } from "@feeblo/ui/icon-picker";
import { cn } from "@feeblo/ui/utils";
import { boardIconName } from "@feeblo/web-shared/icons/defaults";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { Link, useLocation } from "@tanstack/react-router";

import { boardPaths } from "../../lib/board-links";
import { m } from "../../paraglide/messages.js";
import { usePublicCollections } from "../../providers/public-collections-provider";
import { useSite } from "../../providers/site-provider";

export function BoardListCard() {
  const site = useSite();
  const { publicBoardCollection } = usePublicCollections();

  const { data } = useLiveQuery({
    queryKey: [
      "portal-board-list",
      publicBoardCollection.id,
      site.organizationId,
    ],
    query: (q) =>
      q
        .from({ board: publicBoardCollection })
        .where(({ board }) => eq(board.organizationId, site.organizationId)),
  });

  return (
    <div>
      <h3 className="text-muted-foreground mb-2 px-2 text-xs font-medium tracking-wider uppercase">
        {m.happy_upper_firefox()}
      </h3>
      <nav className="flex flex-col gap-0.5">
        <BoardNavLink href={boardPaths.home} label={m.day_key_tuna()} />
        {data?.map((board) => (
          <BoardNavLink
            href={boardPaths.board(board.slug)}
            icon={board.icon}
            key={board.id}
            label={board.name}
          />
        ))}
      </nav>
    </div>
  );
}

export function BoardNavLink({
  href,
  icon,
  label,
  showActiveIndicator = false,
}: {
  href: string;
  icon?: string | null;
  label: string;
  showActiveIndicator?: boolean;
}) {
  const { pathname } = useLocation();
  const isActive = pathname === href;

  return (
    <Link
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        isActive
          ? "bg-muted text-foreground font-medium"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      )}
      to={href}
    >
      {icon === undefined ? (
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            isActive ? "bg-primary" : "bg-muted-foreground/40",
            showActiveIndicator ? "bg-primary" : ""
          )}
        />
      ) : (
        <TablerIcon
          className={cn(
            "size-4",
            isActive ? "text-foreground" : "text-muted-foreground"
          )}
          name={boardIconName(icon)}
        />
      )}
      <span className="truncate">{label}</span>
    </Link>
  );
}
