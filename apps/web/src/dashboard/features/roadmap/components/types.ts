import type { BoardPostStatus } from "../../board/constants";

export type RoadmapStatus = BoardPostStatus;

export type RoadmapStatusDefinition = {
  id: string;
  type: RoadmapStatus;
};

export type RoadmapPost = {
  boardName?: string;
  boardSlug?: string;
  id: string;
  slug: string;
  status: RoadmapStatus;
  statusId: string;
  summary: string;
  title: string;
  updatedAt: Date | string;
};

export type RoadmapLane<TPost extends RoadmapPost = RoadmapPost> = {
  posts: TPost[];
  status: RoadmapStatus;
  statusId: string;
};
