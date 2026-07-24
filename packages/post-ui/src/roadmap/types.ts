import type { BoardPostStatus } from "@feeblo/web-shared/board/constants";

export type RoadmapStatus = BoardPostStatus;

export type RoadmapStatusDefinition = {
  id: string;
  name?: string;
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
  name?: string;
  posts: TPost[];
  status: RoadmapStatus;
  statusId: string;
};
