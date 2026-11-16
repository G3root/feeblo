# Help center

Documentation a workspace publishes on its portal, beside the board, roadmap and changelog. Sections group articles; readers open an article, and the article tells the workspace whether it helped.

This document is the design record for what shipped. The decisions themselves and their reasoning are `docs/adr/0029`.

## Shape

| Table | What it holds |
| --- | --- |
| `help_center_topic` | A section: name, slug, description, icon, position |
| `help_center_article` | The page: title, slug, Markdown body, status, publication date, provenance |
| `help_center_article_view_event` | One row per read, with the client's idempotency key |
| `help_center_article_view_total` | The all-time counter that outlives event retention |
| `help_center_article_feedback` | One reader's "was this helpful?" verdict, flippable in place |
| `site.help_center_visibility` | Whether the portal serves the help center at all |

Every table carries `organization_id` with `onDelete: cascade`, and slugs are unique **per workspace** (`help_center_article_organizationId_slug_uidx`). The article's topic reference is a composite foreign key on `(topic_id, organization_id)` with `ON DELETE RESTRICT`, so an article cannot name another workspace's section and deleting a section cannot silently delete documentation.

## Lifecycle

`packages/domain/src/help-center-article/machine.ts` is the declaration:

```
states:  draft | published | archived
events:  publish | unpublish | archive | restore

draft     --publish--> published
published --unpublish--> draft
published --archive--> archived
archived  --restore--> draft
```

`HELP_CENTER_ARTICLE_STATES` lives in `@feeblo/domain-contracts/help-center-article` because four layers need it and only that package is visible to all of them. The machine derives its states from it, so the column type, the RPC schemas and the graph are one list — `machine.test.ts` walks the whole graph and pins the readable set, the write vocabulary and the "only a transition into published is a publication" predicate.

`archived` is what a withdrawn article becomes. Its link still resolves and the page says it is out of date; it is not a delete, and there is no `deleted_at`.

## Counts

**Views** are two tables, for ADR 0027's reason: the events are pruned and the number is not. The beacon is `AddHelpCenterArticleView`, called once per article per tab session, with a client-generated UUID that makes a retried beacon a no-op. It answers `accepted: boolean` and never states whether an article exists.

**Verdicts** are one table and the counts are aggregates over it — there is no `helpful_count` column. A reader is identified by `user_id` (signed in) or `visitor_id` (a random id in `localStorage`), exactly one of the two, each with its own partial unique index. That is what makes "one vote per reader" true for anonymous readers too: a plain `unique(article_id, user_id)` treats every `NULL` as distinct and would allow one vote per request.

A flip is an `UPDATE` of the same row. Flipping to helpful clears `reason`, because a reason explains the unhelpful vote it was written for.

## Surfaces

**Dashboard** (`ListHelpCenterTopics`, `ListHelpCenterArticles`, create/update/ delete, `ReorderHelpCenterTopics`, `ListHelpCenterArticleFeedback`) sees every state and every section, including empty ones.

**Portal** (`ListHelpCenterTopicsPublic`, `ListHelpCenterArticlesPublic`, `GetHelpCenterArticlePublic`, `GetHelpCenterArticleFeedbackPublic`, `SetHelpCenterArticleFeedback`, `AddHelpCenterArticleView`) sees `published` and `archived` only, reads by slug, and gates on `SitePolicy.canViewHelpCenter`. A section that holds no published article is not listed, so publishing an empty section cannot disclose the draft pipeline.

**Dashboard routes.** `/$organizationId/help-center` lists sections with their articles and the three counters; `/$organizationId/help-center/new` and `/$organizationId/help-center/$articleId` are the editor. The body is a Markdown textarea with a preview, and the list collection holds summaries only — the editor reads one article by id and writes through the RPC operations.

**Portal routes.** `/s/help` and `/s/help/articles/$articleSlug`, which render the stored Markdown, offer "Copy as Markdown", fire the view beacon, and collect the verdict.

## Plan

`helpCenterArticles` is a `LimitFeatureKey`: free is **25**, Starter and Professional are `null` (uncapped). The feature is on every plan; the paid tiers remove the ceiling. Sections are not counted — a workspace at its article ceiling can still reorganise what it has.

## Not built

- **Semantic search.** The embedding columns exist at the shared 1536 dimensions and nothing writes them. There is no `tsvector` anywhere in this codebase; adding one is its own decision.
- **GitHub sync.** `help_center_article.source` reserves the provenance value. The link table, the sync rule, and the file front-matter contract belong to that feature.
- **Content translation.** The repo's i18n is chrome-only (Paraglide). A per-locale body is a product surface, not a column.
- **`llms.txt` for the help center.** The route precedent is `apps/web/src/routes/s/llms[.]txt.ts`; it reads published articles through the same public projection.
