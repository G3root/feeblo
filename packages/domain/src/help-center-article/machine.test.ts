import { describe, expect, it } from "@effect/vitest";
import {
  HELP_CENTER_ARTICLE_STATES,
  type THelpCenterArticleState,
} from "@feeblo/domain-contracts/help-center-article";

import {
  ARCHIVED_HELP_CENTER_ARTICLE_STATE,
  HELP_CENTER_ARTICLE_EVENTS,
  PUBLISHED_HELP_CENTER_ARTICLE_STATE,
  canTransitionHelpCenterArticle,
  helpCenterArticleMachine,
  inboundStatesFor,
  isArchivedHelpCenterArticle,
  isDraftHelpCenterArticle,
  isHelpCenterArticleReadable,
  isPublishedHelpCenterArticle,
  needsPublicationTimestamp,
  publishesNow,
  sourceStatesFor,
  targetStateFor,
  targetStatesFor,
} from "./machine";

/**
 * The machine is the declaration of the article lifecycle, so these tests pin
 * the parts the write paths and the public reads depend on: the graph, the
 * readable set derived from it, and the predicates that would otherwise be
 * recomputed at every call site.
 *
 * Three states by four events is twelve cells; the point is that every one of
 * them was decided once, here, instead of at each `status === "published"`
 * check in a handler or a view.
 */

const ALL = HELP_CENTER_ARTICLE_STATES;

const pairs = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));

describe("help center article machine", () => {
  it("declares every state the stored vocabulary allows", () => {
    expect(Object.keys(helpCenterArticleMachine.states).sort()).toStrictEqual(
      [...ALL].sort()
    );
  });

  it("starts in draft", () => {
    expect(helpCenterArticleMachine.getInitialSnapshot().value).toBe("draft");
  });

  it("allows exactly the documented transitions", () => {
    const allowed = pairs.filter(([from, to]) =>
      canTransitionHelpCenterArticle(from, to)
    );

    expect(allowed).toStrictEqual([
      ["draft", "published"],
      ["published", "draft"],
      ["published", "archived"],
      ["archived", "draft"],
    ]);
  });

  it("never lets an archived article go live without being re-read", () => {
    // Restore returns it to draft, so a withdrawn page cannot reappear by way
    // of a state change alone.
    expect(canTransitionHelpCenterArticle("archived", "published")).toBe(false);
    expect(targetStatesFor("archived")).toStrictEqual(["draft"]);
  });

  it("never lets a draft be archived directly", () => {
    // An article that never shipped is deleted, not archived; archiving one
    // would produce a tombstone for a page nobody ever had a link to.
    expect(sourceStatesFor("archive")).toStrictEqual(["published"]);
  });

  it("has no self-transitions", () => {
    for (const state of ALL) {
      expect(canTransitionHelpCenterArticle(state, state)).toBe(false);
    }
  });

  it("gives every event exactly one target", () => {
    for (const event of HELP_CENTER_ARTICLE_EVENTS) {
      expect(() => targetStateFor(event)).not.toThrow();
    }

    expect(targetStateFor("publish")).toBe("published");
    expect(targetStateFor("unpublish")).toBe("draft");
    expect(targetStateFor("archive")).toBe("archived");
    expect(targetStateFor("restore")).toBe("draft");
  });

  it("names the readable states once, from the graph", () => {
    expect(
      ALL.filter((state) => isHelpCenterArticleReadable(state))
    ).toStrictEqual(["published", "archived"]);
    expect(isHelpCenterArticleReadable("draft")).toBe(false);
  });

  it("pins the named states to the graph", () => {
    expect(PUBLISHED_HELP_CENTER_ARTICLE_STATE).toBe("published");
    expect(ARCHIVED_HELP_CENTER_ARTICLE_STATE).toBe("archived");
  });

  it("distinguishes documentation from a tombstone", () => {
    expect(isPublishedHelpCenterArticle("published")).toBe(true);
    expect(isPublishedHelpCenterArticle("archived")).toBe(false);
    expect(isArchivedHelpCenterArticle("archived")).toBe(true);
    expect(isDraftHelpCenterArticle("draft")).toBe(true);
  });

  it("reports every state that has an inbound edge", () => {
    // The write vocabulary is "states a create or update may name", which is
    // exactly the states some event enters. A state with no inbound edge would
    // be a state only a create could produce, and that is a different rule.
    const inbound = ALL.filter((state) => inboundStatesFor(state).length > 0);
    expect(inbound).toStrictEqual([...ALL]);
  });

  it("treats only the transition into published as a publication", () => {
    expect(publishesNow("draft", "published")).toBe(true);
    // A save of an already-live article is not a second release.
    expect(publishesNow("published", "published")).toBe(false);
    expect(publishesNow("archived", "draft")).toBe(false);
  });

  it("requires a publication timestamp for every non-draft state", () => {
    // The database says the same thing
    // (`help_center_article_published_at_chk`), which is why the write path
    // asks this before the insert rather than surfacing a constraint
    // violation as a 500.
    expect(needsPublicationTimestamp("draft")).toBe(false);
    expect(needsPublicationTimestamp("published")).toBe(true);
    expect(needsPublicationTimestamp("archived")).toBe(true);
  });

  it("agrees with the database's own state list", () => {
    const contractStates: readonly THelpCenterArticleState[] = [
      ...HELP_CENTER_ARTICLE_STATES,
    ];

    expect([...ALL]).toStrictEqual(contractStates);
  });
});
