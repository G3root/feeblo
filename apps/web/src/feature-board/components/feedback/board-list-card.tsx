import { ArrowRightIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "~/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemTitle,
} from "~/components/ui/item";
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
    <Card>
      <CardHeader>
        <CardDescription>Boards</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col">
          {data?.map((board) => (
            <Item
              key={board.id}
              render={
                <Link href={`/b/${board.slug}`}>
                  <ItemContent>
                    <ItemTitle>{board.name}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <HugeiconsIcon className="size-4" icon={ArrowRightIcon} />
                  </ItemActions>
                </Link>
              }
              size="sm"
              variant="default"
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
