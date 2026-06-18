/** biome-ignore-all lint/style/noExportedImports: <explanation> */
import type { Board } from "../../lib/boards";
import { BoardCard } from "./board-card";
import { PoweredByBadge } from "./powered-by-badge";

export function BoardList({ boards }: { boards: Board[] }) {
  return (
    <div className="p-6">
      <p className="font-medium text-foreground text-lg">Give us feedback</p>
      <p className="mt-1 max-w-xs text-muted-foreground text-sm">
        Tell us how we could make the product more useful for you.
      </p>

      <div className="mt-6 space-y-3">
        {boards.map((board) => (
          <BoardCard board={board} key={board.id} />
        ))}
      </div>

      <PoweredByBadge />
    </div>
  );
}

export { BoardCard, PoweredByBadge };
