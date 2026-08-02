import { describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";
import { createMockCollection } from "../testing/in-memory-collections";
import { useDashboardHomeStats } from "./use-dashboard-home-stats";

type TestBoard = {
  id: string;
  name: string;
  organizationId: string;
  slug: string;
  visibility: "PUBLIC" | "PRIVATE";
};

type TestPost = {
  boardId: string;
  content: string;
  createdAt: string;
  id: string;
  organizationId: string;
  slug: string;
  statusId: string;
  title: string;
  updatedAt: string;
};

type TestPostStatus = {
  id: string;
  organizationId: string;
  type: string;
};

type TestUpvote = {
  createdAt: string;
  id: string;
  organizationId: string;
  postId: string;
  userId: string;
};

const ORGANIZATION_ID = "org-1";

function post({ id, createdAt }: { id: string; createdAt: string }): TestPost {
  return {
    boardId: "board-1",
    content: `${id} content`,
    createdAt,
    id,
    organizationId: ORGANIZATION_ID,
    slug: id,
    statusId: "st-1",
    title: `Post ${id}`,
    updatedAt: createdAt,
  };
}

function createCollections(
  overrides: {
    boards?: TestBoard[];
    posts?: TestPost[];
    statuses?: TestPostStatus[];
    upvotes?: TestUpvote[];
  } = {}
) {
  return {
    boardCollection: createMockCollection<TestBoard>({
      id: "boards",
      getKey: (board) => board.id,
      initialData: overrides.boards ?? [
        {
          id: "board-1",
          name: "Board",
          organizationId: ORGANIZATION_ID,
          slug: "board-1",
          visibility: "PUBLIC",
        },
        {
          id: "board-2",
          name: "Other org",
          organizationId: "org-2",
          slug: "other",
          visibility: "PUBLIC",
        },
      ],
    }),
    postCollection: createMockCollection<TestPost>({
      id: "posts",
      getKey: (item) => item.id,
      initialData: overrides.posts ?? [
        post({ id: "post-1", createdAt: "2024-01-01" }),
        post({ id: "post-2", createdAt: "2024-01-02" }),
        post({ id: "post-3", createdAt: "2024-01-03" }),
        post({ id: "post-4", createdAt: "2024-01-04" }),
        post({ id: "post-5", createdAt: "2024-01-05" }),
        post({ id: "post-6", createdAt: "2024-01-06" }),
      ],
    }),
    postStatusCollection: createMockCollection<TestPostStatus>({
      id: "post-statuses",
      getKey: (status) => status.id,
      initialData: overrides.statuses ?? [
        { id: "st-1", organizationId: ORGANIZATION_ID, type: "PENDING" },
      ],
    }),
    upvoteCollection: createMockCollection<TestUpvote>({
      id: "upvotes",
      getKey: (upvote) => upvote.id,
      initialData: overrides.upvotes ?? [
        {
          createdAt: "2024-01-01",
          id: "up-1",
          organizationId: ORGANIZATION_ID,
          postId: "post-1",
          userId: "u-1",
        },
        {
          createdAt: "2024-01-01",
          id: "up-2",
          organizationId: ORGANIZATION_ID,
          postId: "post-1",
          userId: "u-2",
        },
        {
          createdAt: "2024-01-01",
          id: "up-3",
          organizationId: ORGANIZATION_ID,
          postId: "post-2",
          userId: "u-3",
        },
        {
          createdAt: "2024-01-01",
          id: "up-4",
          organizationId: "org-2",
          postId: "post-9",
          userId: "u-4",
        },
      ],
    }),
  };
}

describe("useDashboardHomeStats", () => {
  it("returns only the organization's boards and statuses", async () => {
    const collections = createCollections();
    const { result } = await renderHook(() =>
      useDashboardHomeStats({ ...collections, organizationId: ORGANIZATION_ID })
    );

    await vi.waitFor(() => {
      expect(result.current.boards).toHaveLength(1);
    });

    expect(result.current.boards.map((board) => board.id)).toEqual(["board-1"]);
    expect(result.current.statuses.map((status) => status.type)).toEqual([
      "PENDING",
    ]);
  });

  it("returns at most 5 recent posts ordered by createdAt descending", async () => {
    const collections = createCollections();
    const { result } = await renderHook(() =>
      useDashboardHomeStats({ ...collections, organizationId: ORGANIZATION_ID })
    );

    await vi.waitFor(() => {
      expect(result.current.recentPosts).toHaveLength(5);
    });

    expect(result.current.recentPosts.map((post) => post.id)).toEqual([
      "post-6",
      "post-5",
      "post-4",
      "post-3",
      "post-2",
    ]);
  });

  it("counts upvotes per post within the organization", async () => {
    const collections = createCollections();
    const { result } = await renderHook(() =>
      useDashboardHomeStats({ ...collections, organizationId: ORGANIZATION_ID })
    );

    await vi.waitFor(() => {
      expect(result.current.upvoteCounts).toHaveLength(2);
    });

    expect(result.current.upvoteCounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ count: 2, postId: "post-1" }),
        expect.objectContaining({ count: 1, postId: "post-2" }),
      ])
    );
  });

  it("updates reactively when a post is inserted", async () => {
    const collections = createCollections();
    const { result, act } = await renderHook(() =>
      useDashboardHomeStats({ ...collections, organizationId: ORGANIZATION_ID })
    );

    await vi.waitFor(() => {
      expect(result.current.recentPosts).toHaveLength(5);
    });

    collections.postCollection.utils.begin();
    collections.postCollection.utils.write({
      type: "insert",
      value: post({ id: "post-7", createdAt: "2024-01-07" }),
    });
    collections.postCollection.utils.commit();

    await act(() => {
      // Flush pending reactive updates from the in-memory sync writes.
    });

    await vi.waitFor(() => {
      expect(result.current.recentPosts).toHaveLength(5);
    });

    expect(result.current.recentPosts[0]).toMatchObject({ id: "post-7" });
  });

  it("is disabled without an organization id", async () => {
    const collections = createCollections();
    const { result } = await renderHook(() =>
      useDashboardHomeStats({ ...collections, organizationId: undefined })
    );

    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isError).toBe(false);
    expect(result.current.boards).toEqual([]);
    expect(result.current.statuses).toEqual([]);
    expect(result.current.recentPosts).toEqual([]);
    expect(result.current.upvoteCounts).toEqual([]);
  });
});
