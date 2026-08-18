import { describe, expect, it } from "vitest";

import type { PostActivityActor } from "../post-activity/repository";
import { postTagChangeActivities } from "./post-tag-activities";

const actor: PostActivityActor = {
  actorId: "user-1",
  actorMemberId: null,
  organizationId: "org-1",
  postId: "post-1",
};

describe("postTagChangeActivities", () => {
  it("records TAG_ADDED for tags present in the next set only", () => {
    const activities = postTagChangeActivities({
      previousTagIds: ["a", "b"],
      nextTagIds: ["b", "c"],
      actor,
    });

    expect(activities).toEqual([
      { ...actor, kind: "TAG_ADDED", tagId: "c" },
      { ...actor, kind: "TAG_REMOVED", tagId: "a" },
    ]);
  });

  it("produces no activities when the sets are unchanged", () => {
    expect(
      postTagChangeActivities({
        previousTagIds: ["a", "b"],
        nextTagIds: ["a", "b"],
        actor,
      })
    ).toEqual([]);
  });

  it("records only TAG_REMOVED when tags are cleared", () => {
    expect(
      postTagChangeActivities({
        previousTagIds: ["a", "b"],
        nextTagIds: [],
        actor,
      })
    ).toEqual([
      { ...actor, kind: "TAG_REMOVED", tagId: "a" },
      { ...actor, kind: "TAG_REMOVED", tagId: "b" },
    ]);
  });

  it("records only TAG_ADDED when the previous set was empty", () => {
    expect(
      postTagChangeActivities({
        previousTagIds: [],
        nextTagIds: ["a"],
        actor,
      })
    ).toEqual([{ ...actor, kind: "TAG_ADDED", tagId: "a" }]);
  });

  it("is idempotent: applying the same next set again yields no activities", () => {
    const once = postTagChangeActivities({
      previousTagIds: [],
      nextTagIds: ["a", "b"],
      actor,
    });
    const applied = postTagChangeActivities({
      previousTagIds: ["a", "b"],
      nextTagIds: ["a", "b"],
      actor,
    });

    expect(once).toHaveLength(2);
    expect(applied).toEqual([]);
  });
});
