import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  BOARD_POST_CSV_HEADER,
  type BoardPostCsvRow,
  parseBoardPostCsv,
  serializeBoardPostCsv,
} from "./csv";

const row = (overrides: Partial<BoardPostCsvRow> = {}): BoardPostCsvRow => ({
  authorEmail: null,
  authorName: null,
  board: "Feedback",
  content: "Body",
  createdAt: new Date("2026-01-02T03:04:05.000Z"),
  eta: null,
  status: "Pending",
  tags: [],
  title: "A title",
  updatedAt: new Date("2026-01-03T03:04:05.000Z"),
  url: "https://app.test/org/post/feedback/a-title",
  voteCount: 3,
  ...overrides,
});

describe("board CSV codec", () => {
  it.effect("parses quoted values, embedded commas and newlines", () =>
    Effect.gen(function* () {
      const parsed = yield* parseBoardPostCsv(
        'title,content\n"Hello, world","line one\nline two"\n'
      );

      expect(parsed.rows).toHaveLength(1);
      expect(parsed.rows[0]?.title).toBe("Hello, world");
      expect(parsed.rows[0]?.content).toBe("line one\nline two");
    })
  );

  it.effect("accepts CRLF, a leading BOM, and a trailing newline", () =>
    Effect.gen(function* () {
      const parsed = yield* parseBoardPostCsv(
        "\uFEFFtitle,content\r\nFirst,Body\r\n"
      );

      expect(parsed.rows).toHaveLength(1);
      expect(parsed.rows[0]?.title).toBe("First");
    })
  );

  it.effect("reports the physical line a record starts on", () =>
    Effect.gen(function* () {
      const parsed = yield* parseBoardPostCsv(
        'title,content\nA,"multi\nline"\nB,plain\n'
      );

      expect(parsed.rows.map((row) => row.rowNumber)).toEqual([2, 4]);
    })
  );

  it.effect("deduplicates tags case-insensitively and drops empties", () =>
    Effect.gen(function* () {
      const parsed = yield* parseBoardPostCsv(
        "title,tags\nA,Bug; bug ; ;Feature\n"
      );

      expect(parsed.rows[0]?.tags).toEqual(["Bug", "Feature"]);
    })
  );

  it.effect("lowercases the author email", () =>
    Effect.gen(function* () {
      const parsed = yield* parseBoardPostCsv(
        "title,author_email\nA,Person@Example.COM\n"
      );

      expect(parsed.rows[0]?.authorEmail).toBe("person@example.com");
    })
  );

  it.effect("ignores unknown columns with a notice", () =>
    Effect.gen(function* () {
      const parsed = yield* parseBoardPostCsv(
        "title,content,assignee\nA,Body,Someone\n"
      );

      expect(parsed.rows[0]?.title).toBe("A");
      expect(parsed.notices).toEqual(["Ignoring unknown column: assignee."]);
    })
  );

  it.effect("rejects a file with no title column", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        parseBoardPostCsv("name,content\nA,Body\n")
      );

      expect(error._tag).toBe("InvalidBoardPostCsvError");
    })
  );

  it.effect("rejects an unterminated quoted value", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(parseBoardPostCsv('title\n"A\n'));

      expect(error._tag).toBe("InvalidBoardPostCsvError");
    })
  );

  it.effect("rejects an empty file", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(parseBoardPostCsv(""));

      expect(error._tag).toBe("InvalidBoardPostCsvError");
    })
  );

  it("quotes cells an Excel reader would otherwise split", () => {
    const document = serializeBoardPostCsv([
      row({ content: 'He said "hi", then left', tags: ["a,b", "c"] }),
    ]);

    expect(document.startsWith(BOARD_POST_CSV_HEADER)).toBe(true);
    expect(document).toContain('"He said ""hi"", then left"');
    expect(document).toContain('"a,b;c"');
  });

  it.effect("round-trips a document for the values import reads", () =>
    Effect.gen(function* () {
      const original = row({
        authorEmail: "person@example.com",
        authorName: "Person",
        content: 'Commas, quotes "x" and\na newline',
        eta: "2026-Q2",
        tags: ["Bug", "Feature"],
        title: "Round trip",
      });

      const parsed = yield* parseBoardPostCsv(
        serializeBoardPostCsv([original])
      );

      expect(parsed.rows[0]?.title).toBe(original.title);
      expect(parsed.rows[0]?.content).toBe(original.content);
      expect(parsed.rows[0]?.tags).toEqual(original.tags);
      expect(parsed.rows[0]?.eta).toBe(original.eta);
      expect(parsed.rows[0]?.authorEmail).toBe(original.authorEmail);
      expect(parsed.rows[0]?.createdAt).toBe(original.createdAt.toISOString());
    })
  );
});
