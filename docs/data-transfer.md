# Board CSV transfer

A workspace can export one board's posts to a CSV file and import posts from a CSV file into one board. Both live in **Settings → Data**, need the manager permissions `boards.exportData` and `boards.importPosts`, and are bounded by `DATA_EXPORT_MAX_ROWS` / `DATA_IMPORT_MAX_ROWS` (20,000 rows) and a 10 MB upload cap.

## The contract

The header is the contract. A person can open the file in a spreadsheet, write a script against it, or edit it and import it back:

```text
title,content,status,board,tags,eta,author_name,author_email,vote_count,created_at,updated_at,url
```

| Column | On import |
| --- | --- |
| `title` | Required. A row with an empty title is rejected. |
| `content` | Stored as the post body (sanitized by the shared post write path). |
| `status` | The status **display name** (its label, or the humanized type when unlabeled). Matched case- and separator-insensitively against both. An unknown value imports with the workspace's default open status and a row warning. |
| `board` | Informational: every row lands in the board chosen in the UI. A file naming other boards produces one file-level notice. |
| `tags` | `;`-separated names. Missing tags are created. |
| `eta` | Strict `YYYY-Qn`. Anything else is dropped with a row warning. |
| `author_name` | Fills the contact's name only when the contact is created. |
| `author_email` | Resolves or creates a customer (contact) by email. A malformed address means the post imports without an author. |
| `vote_count` | Read-only decoration. |
| `created_at` | An ISO 8601 instant. Invalid values reject the row; a valid one backdates the post. |
| `updated_at` | Read-only decoration. |
| `url` | Read-only decoration. |

Export writes UTF-8 with a byte-order mark and CRLF line endings so Excel reads non-ASCII titles correctly; import accepts LF or CRLF, a leading BOM, and files marked UTF-16 (Excel's "Unicode Text" export). Free-text values beginning with a formula trigger (`=`, `+`, `-`, `@`, whitespace, `|`, NUL, or a DDE-shaped `=cmd`/`=HYPERLINK` call) are written with an apostrophe marker and quoted, and the marker is removed on import only where it guards such a trigger — a spreadsheet never evaluates a cell, and a round trip is unchanged. Unknown columns are ignored with a notice; a file with no header, no `title` column, or an unterminated quoted value is rejected before anything is staged.

## What import does and does not do

Import is **create-only** (ADR 0013). It never matches or updates an existing post — not by slug, not by title. Exporting a board and importing the file again creates duplicates; re-uploading the same bytes warns on the preview (the job stores the file's SHA-256) but is allowed.

Imported posts:

- carry `source: "IMPORT"` and backdated creation times,
- get one `POST_CREATED` timeline entry, attributed to the uploader,
- do **not** fire integration events (no webhooks), creator or subscriber emails, submission notifications, or the in-app notification feed,
- are embedded for search by a bounded background pass.

An upload stages rows and shows a preview (created / warnings / failed, plus file-level notices); nothing is written to a board until you confirm. Confirmed imports run in a durable worker, one transaction per row, and can be canceled between rows; posts created before a cancel or a failure are kept. The row report shows, per file row number, what happened and a field-scoped message. Jobs and their reports are kept for 30 days.
