import { DragDropProvider } from "@dnd-kit/react";
import { useEffect, useMemo, useState } from "react";
import { BoardGridLaneColumn } from "./board-grid-lane-column";
import type { BoardLane } from "./types";
import { findLaneKeyByPost, movePostToLane } from "./utils";

export function BoardGridView({
  lanes,
  boardSlug,
  organizationId,
}: {
  lanes: BoardLane[];
  boardSlug: string;
  organizationId: string;
}) {
  const [dndLanes, setDndLanes] = useState<BoardLane[]>(lanes);

  useEffect(() => {
    setDndLanes(lanes);
  }, [lanes]);

  const laneMap = useMemo(() => {
    return new Map(dndLanes.map((lane) => [lane.key, lane]));
  }, [dndLanes]);

  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (
          event.canceled ||
          !event.operation.source ||
          !event.operation.target
        ) {
          return;
        }

        const sourceId = String(event.operation.source.id);
        const targetId = String(event.operation.target.id);

        if (!sourceId.startsWith("post:")) {
          return;
        }

        const postSlug = sourceId.replace("post:", "");
        const sourceLaneKey = findLaneKeyByPost(dndLanes, postSlug);
        if (!sourceLaneKey) {
          return;
        }

        const targetLaneKey = targetId.startsWith("lane:")
          ? targetId.replace("lane:", "")
          : findLaneKeyByPost(dndLanes, targetId.replace("post:", ""));

        if (!targetLaneKey) {
          return;
        }

        if (sourceLaneKey === targetLaneKey) {
          return;
        }

        setDndLanes((previousLanes) =>
          movePostToLane(previousLanes, postSlug, sourceLaneKey, targetLaneKey)
        );
      }}
    >
      <section className="overflow-x-auto pb-3">
        <div className="grid min-w-max auto-cols-max grid-flow-col gap-4 p-3">
          {dndLanes.map((lane) => (
            <BoardGridLaneColumn
              boardSlug={boardSlug}
              key={lane.key}
              lane={lane}
              laneMap={laneMap}
              organizationId={organizationId}
            />
          ))}
        </div>
      </section>
    </DragDropProvider>
  );
}
