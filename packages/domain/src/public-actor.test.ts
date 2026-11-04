import { describe, expect, it } from "vitest";

import { redactCreatorIdentities, redactCreatorIdentity } from "./public-actor";

/**
 * The assignee is a member identifier on a public list, so it has to be
 * redacted on every row — including the viewer's own. That last part is what
 * makes it different from `creatorId`: authorship is a fact about the viewer,
 * and who is working on the post is not.
 */
describe("redactCreatorIdentity", () => {
  const row = {
    assigneeMemberId: "mem_assignee",
    creatorId: "user_author",
    creatorMemberId: "mem_author",
  };

  it("drops the assignee even on the viewer's own post", () => {
    expect(redactCreatorIdentity(row, "user_author")).toEqual({
      assigneeMemberId: null,
      creatorId: "user_author",
      creatorMemberId: "mem_author",
    });
  });

  it("drops every identifier on someone else's post", () => {
    expect(redactCreatorIdentity(row, "user_other")).toEqual({
      assigneeMemberId: null,
      creatorId: null,
      creatorMemberId: null,
    });
  });

  it("drops every identifier when nobody is signed in", () => {
    expect(redactCreatorIdentity(row, undefined)).toEqual({
      assigneeMemberId: null,
      creatorId: null,
      creatorMemberId: null,
    });
  });

  it("leaves rows without an assignee column otherwise intact", () => {
    const activity = {
      creatorId: "user_author",
      creatorMemberId: "mem_author",
    };

    expect(redactCreatorIdentity(activity, undefined)).toEqual({
      creatorId: null,
      creatorMemberId: null,
    });
  });

  it("redacts a list row by row", () => {
    expect(
      redactCreatorIdentities(
        [row, { ...row, creatorId: "user_other" }],
        undefined
      )
    ).toEqual([
      { assigneeMemberId: null, creatorId: null, creatorMemberId: null },
      { assigneeMemberId: null, creatorId: null, creatorMemberId: null },
    ]);
  });
});
