import type { BoardPostStatus } from "@feeblo/web-shared/board/constants";

export type BoardPostRow = {
  archivedAt: Date | string | null;
  boardId: string;
  boardName?: string;
  boardSlug: string;
  id: string;
  mergedIntoPostId: string | null;
  slug: string;
  statusId: string;
  status: BoardPostStatus;
  title: string;
  summary: string;
  updatedAt: Date | string;
  upvoteCount: number;
  user: { image: string | null; name: string | null };
};

export type BoardPostLane = {
  label: string;
  posts: BoardPostRow[];
  statusId: string;
  status: BoardPostStatus;
};
