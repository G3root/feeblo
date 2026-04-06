import type { BoardPostStatus } from "../../constants";

export type BoardPostRow = {
  id: string;
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
