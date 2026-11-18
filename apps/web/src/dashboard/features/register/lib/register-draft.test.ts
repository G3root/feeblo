import { describe, expect, it } from "vitest";

import {
  initialDraft,
  isStepComplete,
  maxBoardNameLength,
  maxBoards,
  selectedBoardNames,
  selectedInvites,
} from "./register-draft";

/**
 * The answers each step starts with.
 *
 * These are the rules the wizard renders from, so they are the cheapest place
 * to pin the regression that mattered: a step whose answers are already
 * complete when it appears must say so on the first render. The boards step is
 * the case in point, and it could not be reported by a change because nothing
 * about it changed.
 */
describe("register draft", () => {
  it("opens the boards step already answered", () => {
    const draft = initialDraft();

    expect(draft.boards.every((board) => board.enabled)).toBe(true);
    expect(isStepComplete("boards", draft)).toBe(true);
    expect(selectedBoardNames(draft)).toStrictEqual(["Bugs 🐞", "Features 💡"]);
  });

  it("opens the team step answered, because invitations are optional", () => {
    expect(isStepComplete("team", initialDraft())).toBe(true);
  });

  it("does not open the identity or url steps answered", () => {
    const draft = initialDraft();

    expect(isStepComplete("identity", draft)).toBe(false);
    expect(isStepComplete("url", draft)).toBe(false);
    expect(isStepComplete("url", { ...draft, subdomain: "acme-labs" })).toBe(
      true
    );
  });

  it("refuses an address that is not a single DNS label", () => {
    const draft = initialDraft();

    expect(isStepComplete("url", { ...draft, subdomain: "acme.corp" })).toBe(
      false
    );
    expect(isStepComplete("url", { ...draft, subdomain: "acme_corp" })).toBe(
      false
    );
  });

  it("starts with no more boards than the free plan allows", () => {
    const draft = initialDraft();

    expect(maxBoards).toBe(2);
    expect(draft.boards.length).toBeLessThanOrEqual(maxBoards);
    expect(
      isStepComplete("boards", {
        ...draft,
        boards: [
          ...draft.boards,
          { enabled: true, id: "board-extra", name: "Ideas" },
        ],
      })
    ).toBe(false);
  });

  it("refuses a board with no name, and a name that is too long", () => {
    const draft = initialDraft();

    expect(
      isStepComplete("boards", {
        ...draft,
        boards: [{ enabled: true, id: "board-one", name: " " }],
      })
    ).toBe(false);

    expect(
      isStepComplete("boards", {
        ...draft,
        boards: [
          {
            enabled: true,
            id: "board-long",
            name: "A".repeat(maxBoardNameLength + 1),
          },
        ],
      })
    ).toBe(false);
  });

  it("drops blank and duplicate invitations, in the order they were typed", () => {
    expect(
      selectedInvites({
        ...initialDraft(),
        invites: ["", "Teammate@Example.com", "  ", "teammate@example.com"],
      })
    ).toStrictEqual(["teammate@example.com"]);
  });
});
