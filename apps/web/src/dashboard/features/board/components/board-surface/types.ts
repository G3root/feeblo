import type { BoardPostStatus } from "../../constants";

export type BoardPostRow = {
  id: string;
  slug: string;
  status: BoardPostStatus;
  title: string;
  summary: string;
  updatedAt: Date | string;
};
