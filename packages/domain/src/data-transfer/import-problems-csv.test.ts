import { describe, expect, it } from "@effect/vitest";

import {
  DATA_IMPORT_PROBLEMS_CSV_HEADER,
  serializeDataImportProblemsCsv,
} from "./import-problems-csv";
import type { DataImportProblemRow } from "./repository";

const problemRow = (
  overrides: Partial<DataImportProblemRow> = {}
): DataImportProblemRow => ({
  boardName: "Feedback",
  message: null,
  outcome: "pending",
  rowNumber: 2,
  statusName: "Open",
  title: "A post",
  warnings: ['The board is empty; imported into "Feedback".'],
  ...overrides,
});

describe("serializeDataImportProblemsCsv", () => {
  it("renders no rows as an empty string", () => {
    expect(serializeDataImportProblemsCsv([])).toBe("");
  });

  it("quotes the cells a spreadsheet would otherwise misread", () => {
    const csv = serializeDataImportProblemsCsv([
      problemRow({
        boardName: "Feedback, Inc.",
        message: 'The title is "required".',
        outcome: "failed",
        rowNumber: 7,
        title: "=cmd()",
        warnings: [],
      }),
    ]);

    // A formula trigger is escaped with an apostrophe and quoted with it; a
    // comma and a quote are why a cell gets quotes at all.
    expect(csv).toContain('"\'=cmd()"');
    expect(csv).toContain('"Feedback, Inc."');
    expect(csv).toContain('"The title is ""required""."');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("joins a row's substitutions into one warnings cell", () => {
    const csv = serializeDataImportProblemsCsv([
      problemRow({
        warnings: [
          'The status is empty; imported as "Open".',
          "The eta value is not a quarter (YYYY-Qn); left empty.",
        ],
      }),
    ]);

    expect(csv).toContain("The status is empty; imported as");
    expect(csv).toContain(
      "The eta value is not a quarter (YYYY-Qn); left empty."
    );
  });

  it("names the columns in the header the dashboard links to", () => {
    expect(
      DATA_IMPORT_PROBLEMS_CSV_HEADER.startsWith(
        "\uFEFFrow_number,outcome,title,board,status,message,warnings"
      )
    ).toBe(true);
    expect(DATA_IMPORT_PROBLEMS_CSV_HEADER.endsWith("\r\n")).toBe(true);
  });
});
