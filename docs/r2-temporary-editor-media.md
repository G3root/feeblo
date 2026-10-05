# Temporary editor media

Editor uploads are written under `tmp/editor-media/`. Saving a post or changelog copies referenced objects to `editor-media/`, updates the stored URL, and removes the temporary object after the database transaction succeeds. The promoted copy keeps the temporary object's content type and cache metadata.

An upload the author never saves is reaped by the bucket lifecycle rule alone: `cleanupOrphanedEditorAssets` skips temporary keys on purpose, because the asset row is the only record of an object a still-open editor may yet promote.

Configure the R2 bucket lifecycle with `r2-temporary-editor-media-lifecycle.json`:

```sh
npx wrangler r2 bucket lifecycle set <BUCKET_NAME> \
  --file docs/r2-temporary-editor-media-lifecycle.json
```

The lifecycle file replaces the bucket's lifecycle configuration. Merge this rule with any existing rules before applying it.

## Retention window

The file currently expires abandoned uploads after **7 days**. `AbortIncompleteMultipartUpload` is set to one day; uploads are single `PutObject` calls, so that rule only covers a multipart upload started by something else.

Shortening the window is not free. An open editor holds the temporary URL in its document and promotes it on save, so an object reaped while its author still had the tab open makes the save fail with `Failed to promote temporary editor asset`. Anything shorter than a day is likely to be reached by a dashboard tab left open overnight.

Lengthening it is not free either: temporary objects sit in the same public bucket as everything else (see `r2-production-checklist.md`), so the window is how long an abandoned upload stays readable to anyone who has its URL.

Changing the window is a one-line edit to `Expiration.Days` in the lifecycle file, followed by re-running the command above. Keep the two numbers in this document and in the file in step; they disagreed once already.
