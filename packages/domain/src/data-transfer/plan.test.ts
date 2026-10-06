import { describe, expect, it } from "@effect/vitest";

import type { ParsedBoardPostRow } from "./csv";
import { planImportRows, type ImportPlanStatus } from "./plan";

const PENDING: ImportPlanStatus = {
  id: "status-pending",
  label: "",
  type: "PENDING",
};
const REVIEW: ImportPlanStatus = {
  id: "status-review",
  label: "Under review",
  type: "REVIEW",
};
const STATUSES = [PENDING, REVIEW];

const parsedRow = (
  overrides: Partial<ParsedBoardPostRow> = {}
): ParsedBoardPostRow => ({
  authorEmail: "",
  authorName: "",
  board: "Feedback",
  content: "Body",
  createdAt: "",
  eta: "",
  rowNumber: 2,
  status: "Pending",
  tags: [],
  title: "A title",
  updatedAt: "",
  url: "",
  voteCount: "",
  ...overrides,
});

const planOne = (overrides: Partial<ParsedBoardPostRow> = {}) =>
  planImportRows({
    board: { name: "Feedback", slug: "feedback" },
    defaultStatus: PENDING,
    rows: [parsedRow(overrides)],
    statuses: STATUSES,
  });

describe("import plan", () => {
  it("matches a status by its humanized type when the label differs", () => {
    const plan = planOne({ status: "Review", rowNumber: 3 });

    expect(plan.rows[0]).toMatchObject({
      kind: "pending",
      payload: { statusId: REVIEW.id, warnings: [] },
      rowNumber: 3,
    });
  });

  it("matches a status by its custom label", () => {
    const plan = planOne({ status: "under review" });

    expect(plan.rows[0]).toMatchObject({
      kind: "pending",
      payload: { statusId: REVIEW.id },
    });
  });

  it("falls back to the default status with a warning", () => {
    const plan = planOne({ status: "Wontfix" });

    expect(plan.rows[0]).toMatchObject({
      kind: "pending",
      payload: {
        statusId: null,
        warnings: [
          'The status "Wontfix" is not one of this workspace\'s statuses; imported as "Pending".',
        ],
      },
    });
  });

  it("warns and drops an unreadable eta", () => {
    const plan = planOne({ eta: "Q2 2026" });

    expect(plan.rows[0]).toMatchObject({
      kind: "pending",
      payload: {
        etaQuarter: null,
        warnings: [
          'The eta value "Q2 2026" is not a quarter (YYYY-Qn); left empty.',
        ],
      },
    });
  });

  it("normalizes a valid eta", () => {
    const plan = planOne({ eta: "2026-q3" });

    expect(plan.rows[0]).toMatchObject({
      kind: "pending",
      payload: { etaQuarter: "2026-Q3" },
    });
  });

  it("imports without an author when the email is unusable", () => {
    const plan = planOne({
      authorEmail: "not-an-email",
      authorName: "Someone",
    });

    expect(plan.rows[0]).toMatchObject({
      kind: "pending",
      payload: {
        authorEmail: null,
        authorName: null,
        warnings: [
          "The author email is not a valid address; the post imports without an author.",
        ],
      },
    });
  });

  it("keeps a valid author", () => {
    const plan = planOne({
      authorEmail: "person@example.com",
      authorName: "Person",
    });

    expect(plan.rows[0]).toMatchObject({
      kind: "pending",
      payload: { authorEmail: "person@example.com", authorName: "Person" },
    });
  });

  it("fails a row with no title", () => {
    const plan = planOne({ title: "  " });

    expect(plan.rows[0]).toMatchObject({
      kind: "failed",
      message: "The title is required.",
    });
  });

  it("fails a row whose title is past the post limit", () => {
    const plan = planOne({ title: "x".repeat(201) });

    expect(plan.rows[0]).toMatchObject({
      kind: "failed",
      message: "The title is longer than 200 characters.",
    });
  });

  it("fails a row whose created_at is not an instant", () => {
    const plan = planOne({ createdAt: "last Tuesday" });

    expect(plan.rows[0]).toMatchObject({
      kind: "failed",
      message: "The created_at value is not an ISO 8601 instant.",
    });
  });

  it("normalizes a valid created_at to UTC", () => {
    const plan = planOne({ createdAt: "2026-02-03T04:05:06+02:00" });

    expect(plan.rows[0]).toMatchObject({
      kind: "pending",
      payload: { createdAt: "2026-02-03T02:05:06.000Z" },
    });
  });

  it("notes a file that names another board", () => {
    const plan = planImportRows({
      board: { name: "Feedback", slug: "feedback" },
      defaultStatus: PENDING,
      rows: [
        parsedRow({ board: "Bugs" }),
        parsedRow({ board: "Ideas", rowNumber: 3 }),
      ],
      statuses: STATUSES,
    });

    expect(plan.notices).toEqual([
      'The file names 2 other boards; all rows import into "Feedback".',
    ]);
  });

  it("treats the board name and slug as the same board", () => {
    const plan = planImportRows({
      board: { name: "Feedback", slug: "feedback" },
      defaultStatus: PENDING,
      rows: [parsedRow({ board: "feedback" })],
      statuses: STATUSES,
    });

    expect(plan.notices).toEqual([]);
  });
});
