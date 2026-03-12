import { eq, useLiveQuery } from "@tanstack/react-db";
import { Link, useLocation } from "wouter";
import { cn } from "~/lib/utils";
import { publicBoardCollection } from "../../lib/collections";
import { useSite } from "../../providers/site-provider";

export function BoardListCard() {
  const site = useSite();

  const { data } = useLiveQuery(
    (q) =>
      q
        .from({ board: publicBoardCollection })
        .where(({ board }) => eq(board.organizationId, site.organizationId)),
    [site.organizationId]
  );

  return (
    <div>
      <h3 className="mb-2 px-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
        Boards
      </h3>
      <nav className="flex flex-col gap-0.5">
        <BoardNavLink href="/" label="All feedback" />
        {data?.map((board) => (
          <BoardNavLink
            href={`/b/${board.slug}`}
            key={board.id}
            label={board.name}
          />
        ))}
      </nav>
    </div>
  );
}

function BoardNavLink({ href, label }: { href: string; label: string }) {
  const [location] = useLocation();
  const isActive = location === href;

  return (
    <Link
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        isActive
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      )}
      href={href}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          isActive ? "bg-primary" : "bg-muted-foreground/40"
        )}
      />
      <span className="truncate">{label}</span>
    </Link>
  );
}
