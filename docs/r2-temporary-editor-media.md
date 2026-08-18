# Temporary editor media

Editor uploads are written under `tmp/editor-media/`. Saving a post or changelog copies referenced objects to `editor-media/`, updates the stored URL, and removes the temporary object after the database transaction succeeds.

Configure the R2 bucket lifecycle with `r2-temporary-editor-media-lifecycle.json` so abandoned uploads are deleted after one day:

```sh
npx wrangler r2 bucket lifecycle set <BUCKET_NAME> \
  --file docs/r2-temporary-editor-media-lifecycle.json
```

The lifecycle file replaces the bucket's lifecycle configuration. Merge this rule with any existing rules before applying it.
