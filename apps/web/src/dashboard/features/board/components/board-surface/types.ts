import type { BoardPostStatus } from "../../constants";

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
};

export type BoardPostLane = {
  posts: BoardPostRow[];
  statusId: string;
  status: BoardPostStatus;
};
