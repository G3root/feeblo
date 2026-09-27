import { BoardPage } from "@feeblo/public-feature-board/pages/board";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/s/b/$boardSlug")({
  component: BoardRoute,
});

function BoardRoute() {
  const { boardSlug } = Route.useParams();

  return <BoardPage boardSlug={boardSlug} />;
}
