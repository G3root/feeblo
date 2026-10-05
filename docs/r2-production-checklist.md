# R2 production checklist

The bucket wired through `MEDIA_*` (`packages/domain/src/services/s3-config.ts`) is the only object storage this repo writes to: one **public** bucket holding profile images, organization logos, live editor media, and `tmp/editor-media/` uploads awaiting promotion.

The code enforces what it can — the server refuses to start in production with missing or development-placeholder media configuration (`apps/server/src/config.ts`), and the write path sets the content type and cache metadata itself (`packages/domain/src/services/s3.ts`). Everything the bucket owner has to do by hand is still a checklist item, and §9 lists what is deliberately still open.

## 1. Bucket and access

- [ ] The bucket name matches `MEDIA_PUBLIC_BUCKET_NAME` exactly. A wrong name fails per request, not at startup: the S3 layer is built inside the upload handler (`packages/domain/src/media/api-live.ts`).
- [ ] Public read access is enabled, through a **custom domain** rather than the `r2.dev` subdomain. Cloudflare documents `r2.dev` as non-production (rate-limited, no cache or firewall control).
- [ ] The custom-domain host is what `MEDIA_PUBLIC_BASE_URL` points at (scheme included; a trailing slash is stripped by `resolvePublicUrl`).
- [ ] Bucket jurisdiction/location was chosen deliberately. R2 does not let you change a bucket's jurisdiction after creation.
- [ ] Everyone with a bucket URL can read everything in it. One bucket serves every prefix — `profile-images/`, `organization-logos/`, `editor-media/`, `tmp/editor-media/` — so an image pasted into a draft is world-readable at an unguessable URL until the lifecycle rule deletes it (§5).
- [ ] If a Worker or cache rule sits in front of the bucket, it does not override the `Cache-Control` the uploads set (one hour for `tmp/`, one day elsewhere) with something longer.

## 2. Credentials

- [ ] The API token is scoped to this bucket with Object Read & Write only — not an account-wide admin token.
- [ ] The values are the R2 **S3** access key pair, not a Cloudflare API token.
- [ ] `MEDIA_UPLOAD_REGION` is `auto` and `MEDIA_UPLOAD_ENDPOINT` is `https://<account_id>.r2.cloudflarestorage.com`. The server rejects the `.env.example` credential placeholders in production, but it cannot detect a region left at the MinIO default (`us-east-1`).
- [ ] Credentials live in a secret store, not in the image or a committed env file, and there is a documented rotation path.

## 3. Public URLs

- [ ] `MEDIA_PUBLIC_BASE_URL` is set on the **server** process. In production the server refuses to start without it, because unset `resolvePublicUrl` falls back to `${MEDIA_UPLOAD_ENDPOINT}/${bucket}` — the authenticated S3 endpoint — and every returned URL 403s for every browser. Its shape is the operator's call: the server does not second-guess a loopback host, an address literal, or a relative path. Point it at the bucket's custom domain (`https://assets.feeblo.com`), never at the S3 endpoint.
- [ ] In development the fallback is intentional and works only because the dev MinIO bucket allows anonymous download (`docker/docker-compose.dev.yml`).

## 4. Stored objects

- [ ] `HEAD` a fresh upload and confirm the stored `Content-Type` is the image type, not `application/octet-stream`. The write path now sets it explicitly, because `@effect-aws/s3`'s `writeFile` sent only `Bucket`, `Key`, and `Body` and object storage does not infer a type from the key's extension.
- [ ] Objects uploaded before that change are still served as `application/octet-stream`; nothing backfills them. Confirm that is acceptable, or re-upload them.
- [ ] Confirm the `Cache-Control` on the same object. Promoted editor media keeps the temporary object's value, because `copyObject` copies metadata (`s3.ts`, `promoteEditorMedia`).

## 5. Lifecycle and retention

- [ ] The rule in `docs/r2-temporary-editor-media-lifecycle.json` is actually applied to the bucket. It lives in a JSON file and in no `wrangler.jsonc`, so nothing in the deploy path applies it and drift is invisible.
- [ ] The applied window is the one documented: **7 days**, with `AbortIncompleteMultipartUpload` at one day for uploads this code never starts. Both numbers live in `docs/r2-temporary-editor-media.md`, which explains why shortening the window can fail a save from a long-open editor.
- [ ] Any other lifecycle rules on the bucket were merged into the file first: `wrangler r2 bucket lifecycle set` **replaces** the whole configuration.
- [ ] The team knows the lifecycle rule is the _only_ thing reaping an abandoned `tmp/` upload: `cleanupOrphanedEditorAssets` (`packages/domain/src/asset/service.ts`) filters temporary keys out of its delete list on purpose. Its one-hour grace period applies to promoted objects only.

## 6. Configuration plumbing

- [ ] `docker-compose.yml` requires `MEDIA_UPLOAD_REGION`, `MEDIA_UPLOAD_ENDPOINT`, `MEDIA_UPLOAD_ACCESS_KEY_ID`, `MEDIA_UPLOAD_SECRET_ACCESS_KEY`, and `MEDIA_PUBLIC_BASE_URL` (`:?`), so the self-hosted stack fails at `docker compose up` instead of at the first upload. The operator's `.env` must supply all five; only `MEDIA_PUBLIC_BUCKET_NAME` keeps a default.
- [ ] The region is the one value the server cannot sanity-check: `.env.example` ships `us-east-1` for the dev MinIO, so an operator who copies it into production keeps a value that is wrong for R2 and nothing fails. Set `auto`.

## 7. Abuse and limits

- [ ] The existing guards are known: authenticated only, 10 MB per file, four image types, magic-byte sniffing that must agree with the declared type (`packages/domain/src/media/api-live.ts`).
- [ ] `/api/media/upload` is limited to 60 requests per minute per member (`media-upload` in `packages/domain/src/rate-limit.ts`), on the shared Redis store. Confirm the limit clears a real paste-burst: the editor uploads every pending image at once, so a 429 during a large paste is a user-visible failure rather than a throttle.
- [ ] A storage-growth alert exists. R2 bills on storage and operations; a rising `tmp/` count means either an abuse pattern or a lifecycle rule that stopped running.

## 8. Post-deploy smoke test

Run these against the deployed environment; every misconfiguration above shows up here.

- [ ] Upload an image from a post editor. Expect HTTP 200 and a `url` whose host is `MEDIA_PUBLIC_BASE_URL`.
- [ ] Open that `url` in a private window with no cookies. Expect the image to render, not a 403 and not a download prompt.
- [ ] `HEAD` it: expect an image `Content-Type` and `cache-control: public, max-age=3600`.
- [ ] Save the post. The object should move from `tmp/editor-media/...` to `editor-media/...`, the rewritten URL should render, and the temporary key should be gone from the bucket.
- [ ] `HEAD` the promoted object: expect the content type to have survived the copy.
- [ ] Upload an image and abandon the draft. The object stays under `tmp/` and is reaped by the lifecycle rule — confirm it is actually gone after the retention window.
- [ ] Replace a profile picture or organization logo twice. The first object is deleted by `replaceSingletonAsset`, so a leftover object means deletes are failing.
- [ ] Delete a post that had images, wait out the one-hour grace period, then write or delete another post in the same organization. The orphaned `editor-media/` object should be removed.
- [ ] Paste more than 60 images in a minute and confirm the failure is a clean 429 the editor can retry, not a hung upload.

## 9. Still open

- [ ] **Temporary uploads share the public bucket.** A separate private bucket for `tmp/` would keep an abandoned draft unreadable until it is promoted; it needs a second bucket, a second set of credentials, and a copy across buckets in `promoteEditorMedia`.
- [ ] **Promoted media inherits the one-hour temporary TTL.** Giving it the one-day TTL needs `MetadataDirective: REPLACE` on the copy, which this deployment cannot verify against R2 from here.
- [ ] **`@effect-aws/s3` is no longer imported by anything.** `packages/domain/src/services/s3.ts` now writes through `S3.putObject` directly. Removing the dependency is a catalog change and needs an owner decision.
