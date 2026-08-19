import type { TPostActivityKind } from "@feeblo/db/validation-schema/activity-kind";
import type { TPostActivity } from "@feeblo/domain/post-activity/schema";
import {
  ActivityTimeline,
  ActivityTimelineItem,
} from "@feeblo/ui/activity-timeline";
import { cn } from "@feeblo/ui/utils";
import * as dayjs from "@feeblo/utils/dayjs";
import {
  BOARD_LANE_COLOR_MAP,
  BoardIconMap,
  type BoardPostStatus,
} from "@feeblo/web-shared/board/constants";
import {
  Archive01Icon,
  ArchiveRestoreIcon,
  Calendar03Icon,
  CommentAdd01Icon,
  CommentRemove01Icon,
  Edit01Icon,
  FileAddIcon,
  MessageEdit01Icon,
  MoveIcon,
  NoteEditIcon,
  SquareLock02Icon,
  SquareUnlock02Icon,
  StatusIcon,
  Tag01Icon,
  Tag02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useMemo } from "react";

import {
  boardCollection,
  postActivityCollection,
  postStatusCollection,
  tagCollection,
} from "~/lib/collections";

type NameLookup = ReadonlyMap<string, string>;

const activityIconMap = {
  POST_CREATED: FileAddIcon,
  TITLE_CHANGED: Edit01Icon,
  CONTENT_CHANGED: NoteEditIcon,
  STATUS_CHANGED: StatusIcon,
  BOARD_CHANGED: MoveIcon,
  ETA_CHANGED: Calendar03Icon,
  POST_LOCKED: SquareLock02Icon,
  POST_UNLOCKED: SquareUnlock02Icon,
  POST_ARCHIVED: Archive01Icon,
  POST_UNARCHIVED: ArchiveRestoreIcon,
  TAG_ADDED: Tag01Icon,
  TAG_REMOVED: Tag02Icon,
  OFFICIAL_UPDATE_PUBLISHED: NoteEditIcon,
  COMMENT_CREATED: CommentAdd01Icon,
  COMMENT_UPDATED: MessageEdit01Icon,
  COMMENT_DELETED: CommentRemove01Icon,
} satisfies Record<TPostActivityKind, typeof FileAddIcon>;

const ETA_PATTERN = /^(\d{4})-Q([1-4])$/;

function formatEta(value: string | null) {
  const match = value?.match(ETA_PATTERN);
  if (!match) {
    return null;
  }
  return `Q${match[2]} ${match[1]}`;
}

function getActivityDescription({
  activity,
  boardNames,
  statusNames,
  tagNames,
}: {
  activity: TPostActivity;
  boardNames: NameLookup;
  statusNames: NameLookup;
  tagNames: NameLookup;
}) {
  const descriptions = {
    POST_CREATED: "created this post",
    TITLE_CHANGED: "changed the title",
    CONTENT_CHANGED: "updated the post content",
    STATUS_CHANGED: `changed the status from ${statusNames.get(activity.previousValue ?? "") ?? "Unknown"} to ${statusNames.get(activity.nextValue ?? "") ?? "Unknown"}`,
    BOARD_CHANGED: `moved the post from ${boardNames.get(activity.previousValue ?? "") ?? "Unknown"} to ${boardNames.get(activity.nextValue ?? "") ?? "Unknown"}`,
    ETA_CHANGED:
      activity.nextValue == null
        ? "cleared the ETA"
        : `set the ETA to ${formatEta(activity.nextValue) ?? activity.nextValue}`,
    POST_LOCKED: "locked the post",
    POST_UNLOCKED: "unlocked the post",
    POST_ARCHIVED: "archived the post",
    POST_UNARCHIVED: "restored the post",
    TAG_ADDED: `added the tag ${tagNames.get(activity.nextValue ?? "") ?? "Unknown"}`,
    TAG_REMOVED: `removed the tag ${tagNames.get(activity.nextValue ?? "") ?? "Unknown"}`,
    OFFICIAL_UPDATE_PUBLISHED: "published an official update",
    COMMENT_CREATED:
      activity.nextValue === "INTERNAL"
        ? "added an internal note"
        : "added a comment",
    COMMENT_UPDATED: "updated a comment",
    COMMENT_DELETED: "deleted a comment",
  } satisfies Record<TPostActivityKind, string>;

  return descriptions[activity.kind];
}

type ActivityIcon = { icon: typeof FileAddIcon; color: string };

function getActivityIcon(
  activity: TPostActivity,
  statusTypes: ReadonlyMap<string, BoardPostStatus>
): ActivityIcon {
  if (activity.kind === "STATUS_CHANGED" && activity.nextValue) {
    const statusType = statusTypes.get(activity.nextValue);
    if (statusType) {
      return {
        icon: BoardIconMap[statusType] ?? StatusIcon,
        color: BOARD_LANE_COLOR_MAP[statusType] ?? "text-muted-foreground",
      };
    }
  }

  return {
    icon: activityIconMap[activity.kind],
    color: "text-muted-foreground",
  };
}

export function PostActivityList({
  organizationId,
  postId,
}: {
  organizationId: string;
  postId: string;
}) {
  const { data: activities, isLoading } = useLiveQuery(
    (query) =>
      query
        .from({ activity: postActivityCollection })
        .where(({ activity }) =>
          and(
            eq(activity.organizationId, organizationId),
            eq(activity.postId, postId)
          )
        )
        .orderBy(({ activity }) => activity.createdAt, "desc"),
    [organizationId, postId]
  );
  const { data: statuses } = useLiveQuery(
    (query) =>
      query
        .from({ status: postStatusCollection })
        .where(({ status }) => eq(status.organizationId, organizationId)),
    [organizationId]
  );
  const { data: boards } = useLiveQuery(
    (query) =>
      query
        .from({ board: boardCollection })
        .where(({ board }) => eq(board.organizationId, organizationId)),
    [organizationId]
  );
  const { data: tags } = useLiveQuery(
    (query) =>
      query
        .from({ tag: tagCollection })
        .where(({ tag }) => eq(tag.organizationId, organizationId)),
    [organizationId]
  );

  const statusNames = useMemo(
    () =>
      new Map(
        statuses.map((status) => [
          status.id,
          status.type.replaceAll("_", " ").toLowerCase(),
        ])
      ),
    [statuses]
  );
  const statusTypes = useMemo(
    () => new Map(statuses.map((status) => [status.id, status.type])),
    [statuses]
  );
  const boardNames = useMemo(
    () => new Map(boards.map((board) => [board.id, board.name])),
    [boards]
  );
  const tagNames = useMemo(
    () => new Map(tags.map((tag) => [tag.id, tag.name])),
    [tags]
  );

  if (isLoading) {
    return null;
  }

  if (activities.length === 0) {
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        No activity has been recorded yet.
      </p>
    );
  }

  return (
    <ActivityTimeline className="w-full">
      {activities.map((activity) => {
        const actorName = activity.actor.name ?? "Someone";
        const { icon, color } = getActivityIcon(activity, statusTypes);
        return (
          <ActivityTimelineItem
            icon={
              <HugeiconsIcon
                aria-hidden="true"
                className={cn("size-3.5", color)}
                icon={icon}
                strokeWidth={2}
              />
            }
            key={activity.id}
          >
            {actorName}{" "}
            {getActivityDescription({
              activity,
              boardNames,
              statusNames,
              tagNames,
            })}{" "}
            {dayjs.default(activity.createdAt).fromNow()}
          </ActivityTimelineItem>
        );
      })}
    </ActivityTimeline>
  );
}
