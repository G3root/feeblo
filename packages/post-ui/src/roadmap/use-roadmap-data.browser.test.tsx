import { describe, expect, it, vi } from "vitest";
import type { TSimpleRoadmapFilter } from "@feeblo/domain/roadmap/schema";
import { renderHook } from "vitest-browser-react";
import { createMockCollection } from "../testing/in-memory-collections";
import { useRoadmapData } from "./use-roadmap-data";

type TestBoard = {
  id: string;
  name: string;
  organizationId: string;
  slug: string;
  visibility: string;
};

type TestPost = {
  boardId: string;
  content: string;
  createdAt: Date;
  excerpt: string;
  id: string;
  organizationId: string;
  slug: string;
  statusId: string;
  title: string;
  updatedAt: Date;
};

type TestPostStatus = {
  createdAt: Date;
  id: string;
  orderIndex: number;
  organizationId: string;
  type:
    | "PENDING"
    | "REVIEW"
    | "PLANNED"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "CLOSED";
  updatedAt: Date;
};

type TestRoadmap = {
  createdAt: Date;
  description: string | null;
  filter: TSimpleRoadmapFilter;
  id: string;
  isPrimary: boolean;
  mode: "status" | "filtered";
  name: string;
  organizationId: string;
  slug: string;
  updatedAt: Date;
  visibility: "public" | "private";
};

type TestRoadmapColumn = {
  createdAt: Date;
  id: string;
  name: string;
  position: number;
  roadmapId: string;
  statusId: string;
  updatedAt: Date;
};

const ORGANIZATION_ID = "org-1";

const emptyFilter: TSimpleRoadmapFilter = {
  conditions: [],
  operator: "and",
  version: 1,
};

function roadmap({
  createdAt,
  id,
  mode,
  organizationId = ORGANIZATION_ID,
  filter = emptyFilter,
  slug,
}: {
  createdAt: string;
  filter?: TSimpleRoadmapFilter;
  id: string;
  mode: "status" | "filtered";
  organizationId?: string;
  slug: string;
}): TestRoadmap {
  const date = new Date(createdAt);

  return {
    createdAt: date,
    description: `${slug} description`,
    filter,
    id,
    isPrimary: false,
    mode,
    name: slug,
    organizationId,
    slug,
    updatedAt: date,
    visibility: "public",
  };
}

function post({ id, statusId }: { id: string; statusId: string }): TestPost {
  return {
    boardId: "board-1",
    content: `${id} content`,
    createdAt: new Date("2024-01-01"),
    excerpt: `${id} summary`,
    id,
    organizationId: ORGANIZATION_ID,
    slug: id,
    statusId,
    title: `Post ${id}`,
    updatedAt: new Date("2024-01-01"),
  };
}

function createCollections(
  overrides: {
    roadmaps?: TestRoadmap[];
    columns?: TestRoadmapColumn[];
    posts?: TestPost[];
  } = {}
) {
  return {
    boardCollection: createMockCollection<TestBoard>({
      id: "boards",
      getKey: (board) => board.id,
      initialData: [
        {
          id: "board-1",
          name: "Board",
          organizationId: ORGANIZATION_ID,
          slug: "board-1",
          visibility: "PUBLIC",
        },
      ],
    }),
    postCollection: createMockCollection<TestPost>({
      id: "posts",
      getKey: (post) => post.id,
      initialData: overrides.posts ?? [
        post({ id: "post-1", statusId: "st-planned" }),
        post({ id: "post-2", statusId: "st-in-progress" }),
        post({ id: "post-3", statusId: "st-closed" }),
      ],
    }),
    postStatusCollection: createMockCollection<TestPostStatus>({
      id: "post-statuses",
      getKey: (status) => status.id,
      initialData: [
        {
          createdAt: new Date("2024-01-01"),
          id: "st-planned",
          orderIndex: 0,
          organizationId: ORGANIZATION_ID,
          type: "PLANNED",
          updatedAt: new Date("2024-01-01"),
        },
        {
          createdAt: new Date("2024-01-01"),
          id: "st-in-progress",
          orderIndex: 1,
          organizationId: ORGANIZATION_ID,
          type: "IN_PROGRESS",
          updatedAt: new Date("2024-01-01"),
        },
        {
          createdAt: new Date("2024-01-01"),
          id: "st-completed",
          orderIndex: 2,
          organizationId: ORGANIZATION_ID,
          type: "COMPLETED",
          updatedAt: new Date("2024-01-01"),
        },
        {
          createdAt: new Date("2024-01-01"),
          id: "st-closed",
          orderIndex: 3,
          organizationId: ORGANIZATION_ID,
          type: "CLOSED",
          updatedAt: new Date("2024-01-01"),
        },
      ],
    }),
    roadmapCollection: createMockCollection<TestRoadmap>({
      id: "roadmaps",
      getKey: (roadmap) => roadmap.id,
      initialData: overrides.roadmaps ?? [
        roadmap({
          createdAt: "2024-01-10",
          id: "rm-1",
          mode: "status",
          slug: "launch",
        }),
        roadmap({
          createdAt: "2024-01-05",
          id: "rm-2",
          mode: "status",
          slug: "winter",
        }),
        roadmap({
          createdAt: "2024-01-01",
          id: "rm-filtered",
          mode: "filtered",
          slug: "filtered",
        }),
      ],
    }),
    roadmapColumnCollection: createMockCollection<TestRoadmapColumn>({
      id: "roadmap-columns",
      getKey: (column) => column.id,
      initialData: overrides.columns ?? [
        {
          createdAt: new Date("2024-01-01"),
          id: "col-1",
          name: "Planned",
          position: 0,
          roadmapId: "rm-1",
          statusId: "st-planned",
          updatedAt: new Date("2024-01-01"),
        },
        {
          createdAt: new Date("2024-01-01"),
          id: "col-2",
          name: "In progress",
          position: 1,
          roadmapId: "rm-1",
          statusId: "st-in-progress",
          updatedAt: new Date("2024-01-01"),
        },
        {
          createdAt: new Date("2024-01-01"),
          id: "col-3",
          name: "Done",
          position: 0,
          roadmapId: "rm-2",
          statusId: "st-completed",
          updatedAt: new Date("2024-01-01"),
        },
      ],
    }),
  };
}

describe("useRoadmapData", () => {
  it("returns status-mode roadmaps ordered by createdAt ascending", async () => {
    const collections = createCollections();
    const { result } = await renderHook(() =>
      useRoadmapData({ ...collections, organizationId: ORGANIZATION_ID })
    );

    await vi.waitFor(() => {
      expect(result.current.roadmaps).toHaveLength(2);
    });

    expect(result.current.roadmaps.map((roadmap) => roadmap.slug)).toEqual([
      "winter",
      "launch",
    ]);
    expect(result.current.roadmaps[0]).toMatchObject({
      description: "winter description",
      id: "rm-2",
      name: "winter",
    });
  });

  it("groups posts into lanes respecting column order and dropping unconfigured statuses", async () => {
    const collections = createCollections();
    const { result } = await renderHook(() =>
      useRoadmapData({ ...collections, organizationId: ORGANIZATION_ID })
    );

    await vi.waitFor(() => {
      expect(result.current.posts).toHaveLength(3);
    });

    const lanes = result.current.lanesFor("rm-1");

    expect(lanes.map((lane) => lane.statusId)).toEqual([
      "st-planned",
      "st-in-progress",
    ]);
    expect(lanes.map((lane) => lane.name)).toEqual(["Planned", "In progress"]);
    expect(lanes[0].posts.map((post) => post.id)).toEqual(["post-1"]);
    expect(lanes[1].posts.map((post) => post.id)).toEqual(["post-2"]);
  });

  it("returns empty lanes for roadmaps with no configured columns", async () => {
    const collections = createCollections();
    const { result } = await renderHook(() =>
      useRoadmapData({ ...collections, organizationId: ORGANIZATION_ID })
    );

    await vi.waitFor(() => {
      expect(result.current.columns).toHaveLength(3);
    });

    expect(result.current.lanesFor("rm-2")).toHaveLength(1);
    expect(result.current.lanesFor("rm-2")[0].posts).toEqual([]);
  });

  it("filters roadmaps by slug when provided", async () => {
    const collections = createCollections();
    const { result } = await renderHook(() =>
      useRoadmapData({
        ...collections,
        organizationId: ORGANIZATION_ID,
        slug: "launch",
      })
    );

    await vi.waitFor(() => {
      expect(result.current.roadmaps).toHaveLength(1);
    });

    expect(result.current.roadmaps[0]).toMatchObject({
      id: "rm-1",
      slug: "launch",
    });
  });

  it("allows a slug filter to select a filtered-mode roadmap", async () => {
    const collections = createCollections();
    const { result } = await renderHook(() =>
      useRoadmapData({
        ...collections,
        organizationId: ORGANIZATION_ID,
        slug: "filtered",
      })
    );

    await vi.waitFor(() => {
      expect(result.current.roadmaps).toHaveLength(1);
    });

    expect(result.current.roadmaps[0]).toMatchObject({
      id: "rm-filtered",
      slug: "filtered",
    });
  });

  it("returns no roadmap when the slug filter does not match", async () => {
    const collections = createCollections();
    const { result } = await renderHook(() =>
      useRoadmapData({
        ...collections,
        organizationId: ORGANIZATION_ID,
        slug: "does-not-exist",
      })
    );

    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.roadmaps).toEqual([]);
  });

  it.each([
    {
      filter: {
        conditions: [
          { field: "boardId", operator: "in", value: ["board-1"] },
        ],
        operator: "and",
        version: 1,
      },
      slug: "board-filter",
    },
    {
      filter: {
        conditions: [
          { field: "status", operator: "in", value: ["st-planned"] },
        ],
        operator: "and",
        version: 1,
      },
      slug: "status-filter",
    },
    {
      filter: {
        conditions: [
          {
            field: "tagId",
            operator: "containsAny",
            value: ["tag-1", "tag-2"],
          },
        ],
        operator: "and",
        version: 1,
      },
      slug: "any-tag-filter",
    },
    {
      filter: {
        conditions: [
          {
            field: "tagId",
            operator: "containsAll",
            value: ["tag-1", "tag-2"],
          },
        ],
        operator: "and",
        version: 1,
      },
      slug: "all-tags-filter",
    },
  ] satisfies Array<{ filter: TSimpleRoadmapFilter; slug: string }>)
    ("selects the roadmap with the $slug filter", async ({ filter, slug }) => {
      const collections = createCollections({
        roadmaps: [
          roadmap({
            createdAt: "2024-01-10",
            filter,
            id: `rm-${slug}`,
            mode: "filtered",
            slug,
          }),
          roadmap({
            createdAt: "2024-01-11",
            id: "rm-other",
            mode: "filtered",
            slug: "other-filter",
          }),
        ],
      });
      const { result } = await renderHook(() =>
        useRoadmapData({
          ...collections,
          organizationId: ORGANIZATION_ID,
          slug,
        })
      );

      await vi.waitFor(() => {
        expect(result.current.roadmaps).toHaveLength(1);
      });

      expect(result.current.roadmaps[0]).toMatchObject({
        id: `rm-${slug}`,
        slug,
      });
    });

  it("excludes columns whose roadmap belongs to another organization", async () => {
    const collections = createCollections({
      roadmaps: [
        roadmap({
          createdAt: "2024-01-10",
          id: "rm-1",
          mode: "status",
          slug: "launch",
        }),
        roadmap({
          createdAt: "2024-01-11",
          id: "rm-other-org",
          mode: "status",
          organizationId: "org-2",
          slug: "other-org",
        }),
      ],
      columns: [
        {
          createdAt: new Date("2024-01-01"),
          id: "col-1",
          name: "Planned",
          position: 0,
          roadmapId: "rm-1",
          statusId: "st-planned",
          updatedAt: new Date("2024-01-01"),
        },
        {
          createdAt: new Date("2024-01-01"),
          id: "col-other-org",
          name: "Other organization",
          position: 1,
          roadmapId: "rm-other-org",
          statusId: "st-planned",
          updatedAt: new Date("2024-01-01"),
        },
      ],
    });
    const { result } = await renderHook(() =>
      useRoadmapData({ ...collections, organizationId: ORGANIZATION_ID })
    );

    await vi.waitFor(() => {
      expect(result.current.columns).toHaveLength(1);
    });

    expect(result.current.columns[0]?.roadmapId).toBe("rm-1");
  });

  it("updates lanes reactively when a post is inserted", async () => {
    const collections = createCollections();
    const { result, act } = await renderHook(() =>
      useRoadmapData({ ...collections, organizationId: ORGANIZATION_ID })
    );

    await vi.waitFor(() => {
      expect(result.current.posts).toHaveLength(3);
    });

    collections.postCollection.utils.begin();
    collections.postCollection.utils.write({
      type: "insert",
      value: post({ id: "post-4", statusId: "st-planned" }),
    });
    collections.postCollection.utils.commit();

    await act(() => {
      // Flush pending reactive updates from the in-memory sync writes.
    });

    await vi.waitFor(() => {
      expect(result.current.posts).toHaveLength(4);
    });

    const plannedLane = result.current
      .lanesFor("rm-1")
      .find((lane) => lane.statusId === "st-planned");
    expect(plannedLane?.posts.map((post) => post.id)).toEqual([
      "post-1",
      "post-4",
    ]);
  });

  it("is disabled without an organization id", async () => {
    const collections = createCollections();
    const { result } = await renderHook(() =>
      useRoadmapData({ ...collections, organizationId: undefined })
    );

    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isError).toBe(false);
    expect(result.current.roadmaps).toEqual([]);
    expect(result.current.posts).toEqual([]);
    expect(result.current.lanesFor("rm-1")).toEqual([]);
  });
});
