import { describe, expect, it } from "@effect/vitest";

import {
  CHANGELOG_STATES,
  CHANGELOG_WRITE_STATES,
  PUBLISHED_CHANGELOG_STATUS,
  type TChangelogState,
  canTransitionChangelog,
  changelogMachine,
  inboundStatesFor,
  isPublishedChangelogStatus,
  isWritableChangelogStatus,
  publishesNow,
  sourceStatesFor,
  targetStateFor,
  targetStatesFor,
  writableChangelogStatus,
} from "./machine";

/**
 * The machine is the declaration of the publication lifecycle, so these tests
 * pin the parts the write paths depend on: the graph, the write vocabulary
 * derived from it, and the two predicates that used to be recomputed at four
 * call sites.
 *
 * They are plain assertions rather than property tests: three states by two
 * events is six cells, and the point is that every one of them was considered
 * once, here, instead of at five separate `status === "published"` checks.
 */

const ALL = CHANGELOG_STATES;

const pairs = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));

describe("changelog machine", () => {
  it("declares every status the stored vocabulary allows", () => {
    expect(Object.keys(changelogMachine.states).sort()).toStrictEqual(
      [...ALL].sort()
    );
  });

  it("starts in draft", () => {
    expect(changelogMachine.getInitialSnapshot().value).toBe("draft");
  });

  it("allows exactly the documented transitions", () => {
    const allowed = pairs.filter(([from, to]) =>
      canTransitionChangelog(from, to)
    );

    expect(allowed).toStrictEqual([
      ["draft", "published"],
      ["scheduled", "draft"],
      ["scheduled", "published"],
      ["published", "draft"],
    ]);
  });

  it("lets a published entry return to draft but never skip to scheduled", () => {
    expect(targetStatesFor("draft")).toStrictEqual(["published"]);
    expect(targetStatesFor("published")).toStrictEqual(["draft"]);
    expect(targetStatesFor("scheduled")).toStrictEqual(["draft", "published"]);
  });

  it("keeps scheduled drain-only: it has no inbound edge", () => {
    // The assertion that makes "do not re-introduce scheduling by writing the
    // status" a failing test instead of a comment. `scheduled` survives in the
    // graph because rows filed before the scheduler was dropped may still hold
    // it, and both of its exits exist so such a row can leave.
    expect(inboundStatesFor("scheduled")).toStrictEqual([]);
    expect(targetStateFor("publish")).not.toBe("scheduled");
    expect(targetStateFor("unpublish")).not.toBe("scheduled");
  });

  it("derives each event's sources and target from the same graph", () => {
    expect(sourceStatesFor("publish")).toStrictEqual(["draft", "scheduled"]);
    expect(sourceStatesFor("unpublish")).toStrictEqual([
      "scheduled",
      "published",
    ]);
    expect(targetStateFor("publish")).toBe(PUBLISHED_CHANGELOG_STATUS);
    expect(targetStateFor("unpublish")).toBe("draft");
  });

  it("pins the write vocabulary to the states a write can enter", () => {
    // `CHANGELOG_WRITE_STATES` is declared literally so `Schema.Literals` and
    // `z.enum` can narrow to the write union; this is what keeps that literal
    // list honest. A status a write may name is a status some event enters.
    expect([...CHANGELOG_WRITE_STATES].sort()).toStrictEqual(
      ALL.filter((status) => inboundStatesFor(status).length > 0).sort()
    );
    expect(isWritableChangelogStatus("scheduled")).toBe(false);
    for (const status of CHANGELOG_WRITE_STATES) {
      expect(isWritableChangelogStatus(status)).toBe(true);
    }
  });

  it("rewrites a drain-only status to the draft it effectively is", () => {
    expect(writableChangelogStatus("scheduled")).toBe("draft");
    for (const status of CHANGELOG_WRITE_STATES) {
      expect(writableChangelogStatus(status)).toBe(status);
    }
  });

  it("publishes only on a real move into published", () => {
    expect(publishesNow("draft", "published")).toBe(true);
    expect(publishesNow("scheduled", "published")).toBe(true);
    // Saving a live entry again is a write that changes nothing, so it must
    // not record a second publication intent or notify twice.
    expect(publishesNow("published", "published")).toBe(false);
    expect(publishesNow("published", "draft")).toBe(false);
    expect(publishesNow("draft", "draft")).toBe(false);
  });

  it("names published once, so the predicate follows the graph", () => {
    expect(isPublishedChangelogStatus(PUBLISHED_CHANGELOG_STATUS)).toBe(true);
    expect(ALL.filter(isPublishedChangelogStatus)).toStrictEqual(["published"]);
  });

  it("is reachable from draft, with scheduled named as the one exception", () => {
    const reached = new Set<TChangelogState>(["draft"]);
    let grew = true;

    while (grew) {
      grew = false;
      for (const from of ALL) {
        if (!reached.has(from)) {
          continue;
        }
        for (const to of targetStatesFor(from)) {
          if (!reached.has(to)) {
            reached.add(to);
            grew = true;
          }
        }
      }
    }

    // `scheduled` is the drain-only state: it is reachable only from rows
    // written before scheduling was dropped, never from the initial state.
    const unreachable = ALL.filter((status) => !reached.has(status));

    expect(unreachable).toStrictEqual(["scheduled"]);
    expect(inboundStatesFor("scheduled")).toStrictEqual([]);
  });
});
