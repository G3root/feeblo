import type { BoardPostStatus } from "@feeblo/web-shared/board/constants";

export type RoadmapStatus = BoardPostStatus;

export type RoadmapColumnDefinition = {
  id: string;
  name: string;
  roadmapId: string;
  statusId: string;
  type: RoadmapStatus;
  label: string;
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

export type RoadmapBoardPost = RoadmapPost & {
  boardName: string;
  boardSlug: string;
};

export type RoadmapLane<TPost extends RoadmapPost = RoadmapPost> = {
  label?: string;
  name?: string;
  posts: TPost[];
  status: RoadmapStatus;
  statusId: string;
};
