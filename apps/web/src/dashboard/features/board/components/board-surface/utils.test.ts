import { describe, expect, it } from "vitest";

import type { BoardPostRow } from "./types";
import { groupBoardPosts } from "./utils";

const post = (
  overrides: Partial<BoardPostRow> & { id: string }
): BoardPostRow => ({
  archivedAt: null,
  assigneeMemberId: null,
  authorIsMember: true,
  boardId: "board-features",
  boardName: "Features",
  boardSlug: "features",
  mergedIntoPostId: null,
  slug: overrides.id,
  status: "PLANNED",
  statusId: "status-planned",
  summary: "",
  title: overrides.id,
  updatedAt: new Date(0),
  upvoteCount: 0,
  user: { image: null, name: null },
  ...overrides,
});

const postStatuses = [
  { id: "status-planned", label: "Planned", type: "PLANNED" as const },
  { id: "status-completed", label: "Completed", type: "COMPLETED" as const },
];

const noTags = new Map<string, readonly string[]>();

describe("groupBoardPosts", () => {
  it("keeps status order and drops empty status lanes", () => {
    const planned = post({ id: "planned" });
    const completed = post({
      id: "completed",
      status: "COMPLETED",
      statusId: "status-completed",
    });

    const lanes = groupBoardPosts({
      groupBy: "status",
      members: [],
      posts: [completed, planned],
      postStatuses,
      postTagsByPostId: noTags,
      tags: [],
    });

    expect(lanes.map((lane) => lane.label)).toEqual(["Planned", "Completed"]);
    expect(lanes.map((lane) => lane.id)).toEqual([
      "status-planned",
      "status-completed",
    ]);
    expect(lanes[0]?.posts.map((row) => row.id)).toEqual(["planned"]);
  });

  it("puts unassigned posts last and keeps posts from unknown members", () => {
    const alice = post({ id: "alice", assigneeMemberId: "member-alice" });
    const bob = post({ id: "bob", assigneeMemberId: "member-bob" });
    const missing = post({ id: "missing", assigneeMemberId: "member-gone" });
    const unassigned = post({ id: "unassigned" });

    const lanes = groupBoardPosts({
      groupBy: "assignee",
      members: [
        { id: "member-alice", name: "Alice" },
        { id: "member-bob", name: "Bob" },
        { id: "member-empty", name: "Empty" },
      ],
      posts: [unassigned, missing, bob, alice],
      postStatuses,
      postTagsByPostId: noTags,
      tags: [],
    });

    expect(lanes.map((lane) => lane.label)).toEqual([
      "Alice",
      "Bob",
      "Unknown member",
      "Unassigned",
    ]);
    expect(lanes.at(-1)?.posts.map((row) => row.id)).toEqual(["unassigned"]);
  });

  it("orders board lanes by the board's name", () => {
    const zeta = post({ boardId: "board-zeta", boardName: "Zeta", id: "zeta" });
    const alpha = post({
      boardId: "board-alpha",
      boardName: "Alpha",
      id: "alpha",
    });

    const lanes = groupBoardPosts({
      groupBy: "board",
      members: [],
      posts: [zeta, alpha],
      postStatuses,
      postTagsByPostId: noTags,
      tags: [],
    });

    expect(lanes.map((lane) => lane.label)).toEqual(["Alpha", "Zeta"]);
  });

  it("puts a multi-label post in each label lane and collects the rest", () => {
    const both = post({ id: "both" });
    const none = post({ id: "none" });
    const unknown = post({ id: "unknown" });

    const lanes = groupBoardPosts({
      groupBy: "label",
      members: [],
      posts: [both, none, unknown],
      postStatuses,
      postTagsByPostId: new Map([
        ["both", ["tag-beta", "tag-alpha"]],
        ["unknown", ["tag-deleted"]],
      ]),
      tags: [
        { id: "tag-alpha", name: "Alpha" },
        { id: "tag-beta", name: "Beta" },
      ],
    });

    expect(lanes.map((lane) => lane.label)).toEqual([
      "Alpha",
      "Beta",
      "No label",
    ]);
    expect(lanes[0]?.posts.map((row) => row.id)).toEqual(["both"]);
    expect(lanes[1]?.posts.map((row) => row.id)).toEqual(["both"]);
    expect(lanes[2]?.posts.map((row) => row.id)).toEqual(["none", "unknown"]);
  });

  it("renders one lane with every post when grouping is off", () => {
    const first = post({ id: "first" });
    const second = post({ id: "second" });

    const lanes = groupBoardPosts({
      groupBy: "none",
      members: [],
      posts: [first, second],
      postStatuses,
      postTagsByPostId: noTags,
      tags: [],
    });

    expect(lanes).toEqual([
      { id: "all", label: "All posts", posts: [first, second] },
    ]);
  });
});
