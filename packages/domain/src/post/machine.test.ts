import { describe, expect, it } from "@effect/vitest";

import {
  ARCHIVED_POST_PRESENCE,
  LISTED_POST_PRESENCE,
  LOCKED_POST_ENGAGEMENT,
  MERGED_POST_PRESENCE,
  OPEN_POST_ENGAGEMENT,
  POST_ENGAGEMENT_EVENTS,
  POST_ENGAGEMENT_STATES,
  POST_PRESENCE_EVENTS,
  POST_PRESENCE_STATES,
  UNSUPERSEDED_POST_PRESENCE_STATES,
  type TPostEngagement,
  type TPostPresence,
  canTransitionPostEngagement,
  canTransitionPostPresence,
  engagementForLock,
  engagementOf,
  engagementSourceStatesFor,
  engagementTargetStateFor,
  isArchivedPostPresence,
  isMergedPostPresence,
  postEngagementMachine,
  postPresenceMachine,
  presenceOf,
  presenceSourceStatesFor,
  presenceTargetStateFor,
} from "./machine";

/**
 * The machines are the declaration of the post's two lifecycles, so these tests
 * pin the parts the guards and the SQL are generated from: the graph, the
 * single target of every event, and the derivation that reads a stored row back
 * into a state.
 *
 * Three presence states by four events and two engagement states by two events
 * is eighteen cells; the point is that every one of them was considered once,
 * here, instead of across the four guards, the two `isUnlocked` clauses and the
 * visibility fragment.
 */

const presencePairs = POST_PRESENCE_STATES.flatMap((from) =>
  POST_PRESENCE_STATES.map((to) => [from, to] as const)
);

const engagementPairs = POST_ENGAGEMENT_STATES.flatMap((from) =>
  POST_ENGAGEMENT_STATES.map((to) => [from, to] as const)
);

const presenceRow = (presence: TPostPresence) => ({
  archivedAt: presence === LISTED_POST_PRESENCE ? null : new Date(0),
  mergedIntoPostId: presence === MERGED_POST_PRESENCE ? "pst_survivor" : null,
});

describe("post presence machine", () => {
  it("declares exactly the documented states", () => {
    expect(Object.keys(postPresenceMachine.states).sort()).toStrictEqual(
      [...POST_PRESENCE_STATES].sort()
    );
    expect(Object.keys(postEngagementMachine.states).sort()).toStrictEqual(
      [...POST_ENGAGEMENT_STATES].sort()
    );
  });

  it("starts listed and open", () => {
    expect(postPresenceMachine.getInitialSnapshot().value).toBe(
      LISTED_POST_PRESENCE
    );
    expect(postEngagementMachine.getInitialSnapshot().value).toBe(
      OPEN_POST_ENGAGEMENT
    );
  });

  it("allows exactly the documented presence transitions", () => {
    const allowed = presencePairs.filter(([from, to]) =>
      canTransitionPostPresence(from, to)
    );

    expect(allowed).toStrictEqual([
      [LISTED_POST_PRESENCE, ARCHIVED_POST_PRESENCE],
      [LISTED_POST_PRESENCE, MERGED_POST_PRESENCE],
      [ARCHIVED_POST_PRESENCE, LISTED_POST_PRESENCE],
      [MERGED_POST_PRESENCE, LISTED_POST_PRESENCE],
    ]);
  });

  it("allows exactly the documented engagement transitions", () => {
    const allowed = engagementPairs.filter(([from, to]) =>
      canTransitionPostEngagement(from, to)
    );

    expect(allowed).toStrictEqual([
      [OPEN_POST_ENGAGEMENT, LOCKED_POST_ENGAGEMENT],
      [LOCKED_POST_ENGAGEMENT, OPEN_POST_ENGAGEMENT],
    ]);
  });

  it("derives each event's sources and single target from the graph", () => {
    expect(presenceSourceStatesFor("archive")).toStrictEqual([
      LISTED_POST_PRESENCE,
    ]);
    expect(presenceSourceStatesFor("unarchive")).toStrictEqual([
      ARCHIVED_POST_PRESENCE,
    ]);
    // The merge guard's whole rule: only a listed post may be a source or a
    // target, which is what refuses an archived endpoint and a chained merge.
    expect(presenceSourceStatesFor("merge")).toStrictEqual([
      LISTED_POST_PRESENCE,
    ]);
    expect(presenceSourceStatesFor("unmerge")).toStrictEqual([
      MERGED_POST_PRESENCE,
    ]);

    expect(presenceTargetStateFor("archive")).toBe(ARCHIVED_POST_PRESENCE);
    expect(presenceTargetStateFor("merge")).toBe(MERGED_POST_PRESENCE);
    expect(presenceTargetStateFor("unarchive")).toBe(LISTED_POST_PRESENCE);
    expect(presenceTargetStateFor("unmerge")).toBe(LISTED_POST_PRESENCE);

    expect(engagementSourceStatesFor("lock")).toStrictEqual([
      OPEN_POST_ENGAGEMENT,
    ]);
    expect(engagementSourceStatesFor("unlock")).toStrictEqual([
      LOCKED_POST_ENGAGEMENT,
    ]);
    expect(engagementTargetStateFor("lock")).toBe(LOCKED_POST_ENGAGEMENT);
    expect(engagementTargetStateFor("unlock")).toBe(OPEN_POST_ENGAGEMENT);
  });

  it("has no self-transition on any event", () => {
    // A state that takes an event and stays put would make "handled" and
    // "rejected" indistinguishable, and `presenceSourceStatesFor` — the
    // function the guarded `UPDATE`s are generated from — would silently drop
    // it. The lease-like re-claims elsewhere in the repo are SQL predicates for
    // exactly this reason.
    for (const event of POST_PRESENCE_EVENTS) {
      for (const source of presenceSourceStatesFor(event)) {
        expect(presenceTargetStateFor(event)).not.toBe(source);
      }
    }
    for (const event of POST_ENGAGEMENT_EVENTS) {
      for (const source of engagementSourceStatesFor(event)) {
        expect(engagementTargetStateFor(event)).not.toBe(source);
      }
    }
  });

  it("reads a stored row back into the state it is in", () => {
    for (const presence of POST_PRESENCE_STATES) {
      expect(presenceOf(presenceRow(presence))).toBe(presence);
    }
    // The one that would be wrong under the obvious ordering: a merged row also
    // carries `archivedAt` (the CHECK constraint requires it), so testing the
    // archive column first would report every merged post as archived.
    expect(
      presenceOf({ archivedAt: new Date(0), mergedIntoPostId: "pst_survivor" })
    ).toBe(MERGED_POST_PRESENCE);
    expect(presenceOf({ archivedAt: null, mergedIntoPostId: null })).toBe(
      LISTED_POST_PRESENCE
    );
  });

  it("reads the lock column back into an engagement", () => {
    expect(engagementOf({ lockedAt: null })).toBe(OPEN_POST_ENGAGEMENT);
    expect(engagementOf({ lockedAt: new Date(0) })).toBe(
      LOCKED_POST_ENGAGEMENT
    );
    for (const locked of [true, false]) {
      expect(engagementOf({ lockedAt: locked ? new Date(0) : null })).toBe(
        engagementForLock(locked)
      );
    }
  });

  it("names every state from the graph rather than a literal", () => {
    expect(ARCHIVED_POST_PRESENCE).toBe("archived");
    expect(MERGED_POST_PRESENCE).toBe("merged");
    expect(LISTED_POST_PRESENCE).toBe("listed");
    expect(LOCKED_POST_ENGAGEMENT).toBe("locked");
    expect(OPEN_POST_ENGAGEMENT).toBe("open");
  });

  it("treats every presence but merged as unsuperseded", () => {
    // Archiving removes a post from lists, not from its own page: `isUnlocked`
    // and the public-visibility predicate both depend on that distinction.
    expect([...UNSUPERSEDED_POST_PRESENCE_STATES]).toStrictEqual([
      LISTED_POST_PRESENCE,
      ARCHIVED_POST_PRESENCE,
    ]);
    for (const presence of POST_PRESENCE_STATES) {
      expect(isMergedPostPresence(presence)).toBe(
        !UNSUPERSEDED_POST_PRESENCE_STATES.includes(presence)
      );
    }
  });

  it("classifies each presence by the state it names", () => {
    expect(isArchivedPostPresence(ARCHIVED_POST_PRESENCE)).toBe(true);
    expect(isMergedPostPresence(MERGED_POST_PRESENCE)).toBe(true);
    // The merge guard's whole rule: only a listed post may be a source or a
    // target, which is what refuses an archived endpoint and a chained merge.
    expect(presenceSourceStatesFor("merge")).toStrictEqual([
      LISTED_POST_PRESENCE,
    ]);
  });

  it("is reachable: every state has a path from the initial one", () => {
    const reachedPresence = new Set<TPostPresence>([LISTED_POST_PRESENCE]);
    const reachedEngagement = new Set<TPostEngagement>([OPEN_POST_ENGAGEMENT]);
    let grew = true;

    while (grew) {
      grew = false;
      for (const from of POST_PRESENCE_STATES) {
        if (!reachedPresence.has(from)) {
          continue;
        }
        for (const to of POST_PRESENCE_STATES) {
          if (canTransitionPostPresence(from, to) && !reachedPresence.has(to)) {
            reachedPresence.add(to);
            grew = true;
          }
        }
      }
      for (const from of POST_ENGAGEMENT_STATES) {
        if (!reachedEngagement.has(from)) {
          continue;
        }
        for (const to of POST_ENGAGEMENT_STATES) {
          if (
            canTransitionPostEngagement(from, to) &&
            !reachedEngagement.has(to)
          ) {
            reachedEngagement.add(to);
            grew = true;
          }
        }
      }
    }

    expect([...reachedPresence].sort()).toStrictEqual(
      [...POST_PRESENCE_STATES].sort()
    );
    expect([...reachedEngagement].sort()).toStrictEqual(
      [...POST_ENGAGEMENT_STATES].sort()
    );
  });
});
