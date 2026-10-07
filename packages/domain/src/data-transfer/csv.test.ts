import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  BOARD_POST_CSV_HEADER,
  type BoardPostCsvRow,
  decodeBoardPostCsv,
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

  it("guards free-text cells a spreadsheet would evaluate", () => {
    const document = serializeBoardPostCsv([
      row({
        content: "=1+1",
        status: "+SUM(A1)",
        tags: ["@here"],
        title: "-lookup",
      }),
    ]);
    const dataLine = document.split("\r\n")[1] ?? "";

    expect(dataLine).toContain('"\'=1+1"');
    expect(dataLine).toContain('"\'+SUM(A1)"');
    expect(dataLine).toContain('"\'@here"');
    expect(dataLine).toContain('"\'-lookup"');
  });

  it("does not alter generated number and timestamp cells", () => {
    const document = serializeBoardPostCsv([row({ voteCount: -3 })]);
    const dataLine = document.split("\r\n")[1] ?? "";

    expect(dataLine).toContain(",-3,");
    expect(dataLine).not.toContain("'-3");
    expect(dataLine).toContain("2026-01-02T03:04:05.000Z");
  });

  it.effect(
    "removes the formula marker on import only when one was added",
    () =>
      Effect.gen(function* () {
        const parsed = yield* parseBoardPostCsv(
          [
            "title,content,tags",
            '"\'=1+1","\'+SUM(A1)","\'@here"',
            "'hello,plain,value",
          ].join("\n")
        );

        expect(parsed.rows[0]).toMatchObject({
          content: "+SUM(A1)",
          tags: ["@here"],
          title: "=1+1",
        });
        // An apostrophe that does not guard a trigger is part of the value.
        expect(parsed.rows[1]?.title).toBe("'hello");
        expect(parsed.rows[1]?.content).toBe("plain");
      })
  );

  it.effect("round-trips formula-looking values unchanged", () =>
    Effect.gen(function* () {
      const original = row({
        content: "-5",
        tags: ["=cmd"],
        title: "@user",
      });

      const parsed = yield* parseBoardPostCsv(
        serializeBoardPostCsv([original])
      );

      expect(parsed.rows[0]).toMatchObject({
        content: "-5",
        tags: ["=cmd"],
        title: "@user",
      });
    })
  );

  it("guards the remaining formula triggers a spreadsheet honours", () => {
    const document = serializeBoardPostCsv([
      row({
        content: "\u0000zero",
        status: "|pipe",
        title: "=cmd|'/C calc'!A0",
      }),
    ]);
    const dataLine = document.split("\r\n")[1] ?? "";

    expect(dataLine).toContain('"\'\u0000zero"');
    expect(dataLine).toContain('"\'|pipe"');
    expect(dataLine).toContain("\"'=cmd|'/C calc'!A0\"");
  });

  it("guards a data-exfiltration function", () => {
    const document = serializeBoardPostCsv([
      row({ content: '=HYPERLINK("http://example.test")' }),
    ]);

    expect(document).toContain('"\'=HYPERLINK(""http://example.test"")"');
  });

  it.effect("decodes a UTF-16LE file carrying a byte-order mark", () =>
    Effect.gen(function* () {
      const text = "title,content\nFirst,Body\n";
      const bytes = new Uint8Array(2 + text.length * 2);
      bytes[0] = 0xff;
      bytes[1] = 0xfe;
      for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        bytes[2 + index * 2] = code & 0xff;
        bytes[3 + index * 2] = code >> 8;
      }

      const decoded = yield* decodeBoardPostCsv(bytes);

      expect(decoded).toBe(text);
    })
  );

  it.effect("rejects bytes that are neither UTF-8 nor marked UTF-16", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decodeBoardPostCsv(new Uint8Array([0xc3, 0x28, 0x61]))
      );

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
