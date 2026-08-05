import type { TPostActivityKind } from "@feeblo/db";
import type { TPostActivity } from "@feeblo/domain/post-activity/schema";
import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from "@feeblo/ui/reui/timeline";
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
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { useMemo } from "react";

import {
  boardCollection,
  postActivityCollection,
  postStatusCollection,
} from "~/lib/collections";

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function formatRelativeTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  const difference = date.getTime() - Date.now();
  const minutes = Math.round(difference / 60_000);
  if (Math.abs(minutes) < 60) {
    return relativeTime.format(minutes, "minute");
  }
  const hours = Math.round(difference / 3_600_000);
  if (Math.abs(hours) < 24) {
    return relativeTime.format(hours, "hour");
  }
  return relativeTime.format(Math.round(difference / 86_400_000), "day");
}

type NameLookup = ReadonlyMap<string, string>;

const activityIconMap: Record<TPostActivityKind, typeof FileAddIcon> = {
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
  COMMENT_CREATED: CommentAdd01Icon,
  COMMENT_UPDATED: MessageEdit01Icon,
  COMMENT_DELETED: CommentRemove01Icon,
};

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
}: {
  activity: TPostActivity;
  boardNames: NameLookup;
  statusNames: NameLookup;
}) {
  const descriptions: Record<TPostActivityKind, string> = {
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
    COMMENT_CREATED:
      activity.nextValue === "INTERNAL"
        ? "added an internal note"
        : "added a comment",
    COMMENT_UPDATED: "updated a comment",
    COMMENT_DELETED: "deleted a comment",
  };

  return descriptions[activity.kind];
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
  const boardNames = useMemo(
    () => new Map(boards.map((board) => [board.id, board.name])),
    [boards]
  );

  if (isLoading) {
    return null;
  }

  if (activities.length === 0) {
    return (
      <p className="py-10 text-center text-muted-foreground text-sm">
        No activity has been recorded yet.
      </p>
    );
  }

  return (
    <Timeline className="w-full" value={activities.length}>
      {activities.map((activity, index) => {
        const actorName = activity.actor.name ?? "Someone";
        return (
          <TimelineItem
            className="group-data-[orientation=vertical]/timeline:ms-10"
            key={activity.id}
            step={index + 1}
          >
            <TimelineHeader>
              <TimelineSeparator className="group-data-[orientation=vertical]/timeline:-left-7 group-data-[orientation=vertical]/timeline:h-[calc(100%-1.5rem-0.25rem)] group-data-[orientation=vertical]/timeline:translate-y-6.5" />
              <TimelineTitle className="mt-0.5">{actorName}</TimelineTitle>
              <TimelineIndicator className="flex size-6 items-center justify-center border-none bg-primary/10 group-data-[orientation=vertical]/timeline:-left-7 group-data-completed/timeline-item:bg-primary group-data-completed/timeline-item:text-primary-foreground">
                <HugeiconsIcon
                  aria-hidden="true"
                  className="size-3.5"
                  icon={activityIconMap[activity.kind]}
                  strokeWidth={2}
                />
              </TimelineIndicator>
            </TimelineHeader>
            <TimelineContent>
              {getActivityDescription({
                activity,
                boardNames,
                statusNames,
              })}
              <TimelineDate
                className="mt-2 mb-0"
                dateTime={activity.createdAt.toISOString()}
              >
                {formatRelativeTime(activity.createdAt)}
              </TimelineDate>
            </TimelineContent>
          </TimelineItem>
        );
      })}
    </Timeline>
  );
}
