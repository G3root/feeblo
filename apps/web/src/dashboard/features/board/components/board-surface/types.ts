import type { BoardPostStatus } from "@feeblo/web-shared/board/constants";

export type BoardPostRow = {
  archivedAt: Date | string | null;
  /** The member working on this post; null when unassigned. */
  assigneeMemberId: string | null;
  authorIsMember: boolean;
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
  /** Stable across regroupings: a status id, member id, board id, tag id, or "all". */
  id: string;
  label: string;
  posts: BoardPostRow[];
  /**
   * Present only on status lanes. The list's add-post button and the grid's
   * drop target both write a status, so a lane grouped by anything else has no
   * status to write.
   */
  status?: BoardPostStatus;
  statusId?: string;
};

/** The names behind an assignee lane. */
export type BoardGroupingMember = {
  id: string;
  name: string;
};

/** The names behind a label lane. */
export type BoardGroupingTag = {
  id: string;
  name: string;
};
