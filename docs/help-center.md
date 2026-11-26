# Help center

Documentation a workspace publishes on its portal, beside the board, roadmap and changelog. Sections group articles; readers open an article, and the article tells the workspace whether it helped.

This document is the design record for what shipped.

## Shape

| Table | What it holds |
| --- | --- |
| `help_center_topic` | A section: name, slug, description, icon, position |
| `help_center_article` | The page: title, slug, Markdown body, cover image, status, publication date, provenance |
| `help_center_article_view_event` | One row per read, with the client's idempotency key |
| `help_center_article_view_total` | The all-time counter that outlives event retention |
| `help_center_article_feedback` | One reader's "was this helpful?" verdict, flippable in place |
| `help_center_article_daily` | One article's views and verdicts, bucketed by UTC day |
| `help_center_search_daily` | What readers searched for, and how often it found nothing, bucketed by UTC day |
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

**Views** are two tables, because the events are pruned and the number is not. The beacon is `AddHelpCenterArticleView`, called once per article per tab session, with a client-generated UUID that makes a retried beacon a no-op. It answers `accepted: boolean` and never states whether an article exists.

**Verdicts** are one table and the counts are aggregates over it — there is no `helpful_count` column. A reader is identified by `user_id` (signed in) or `visitor_id` (a random id in `localStorage`), exactly one of the two, each with its own partial unique index. That is what makes "one vote per reader" true for anonymous readers too: a plain `unique(article_id, user_id)` treats every `NULL` as distinct and would allow one vote per request.

A flip is an `UPDATE` of the same row. Flipping to helpful clears `reason`, because a reason explains the unhelpful vote it was written for.

## Surfaces

**Dashboard** (`ListHelpCenterTopics`, `ListHelpCenterArticles`, create/update/ delete, `ReorderHelpCenterTopics`, `ListHelpCenterArticleFeedback`) sees every state and every section, including empty ones.

**Portal** (`ListHelpCenterTopicsPublic`, `ListHelpCenterArticlesPublic`, `GetHelpCenterArticlePublic`, `GetHelpCenterArticleFeedbackPublic`, `SetHelpCenterArticleFeedback`, `AddHelpCenterArticleView`) sees `published` and `archived` only, reads by slug, and gates on `SitePolicy.canViewHelpCenter`. A section that holds no published article is not listed, so publishing an empty section cannot disclose the draft pipeline.

**Dashboard routes.** `/$organizationId/help-center` lists the sections and their article counts, and is the only place a section is created. `/$organizationId/help-center/$topicId` is one section: its articles with the three counters, plus the section's edit and delete actions. `/$organizationId/help-center/$topicId/new` and `/$organizationId/help-center/article/$articleId` are the editor, opened on the create page with its section already chosen. It has the changelog editor's shape: a cover image, a title, the body, and a sidebar with the section. The slug is not a field — it is chosen in the publish dialog, so a save cannot move a live page's URL — and saving keeps the current status while publishing asks for the slug and date. The state changes the lifecycle does not derive from those (`archive`, `restore`) are offered beside the article's delete action. The body is edited in the same ProseKit editor the changelog uses and stored as Markdown — the editor serializes its document to Markdown and parses it back — so pasted images are written to `tmp/editor-media/` and the write's `assetIds` let the handler promote them to permanent objects before the row stores their URLs. The list collection holds summaries only — the editor reads one article by id and writes through the RPC operations. The dashboard's search is a command dialog behind an icon in the index toolbar; it reads the dashboard `SearchHelpCenterArticles` operation, so drafts are findable.

**Portal routes.** `/s/help` and `/s/help/articles/$articleSlug`, in three columns: a rail of sections that opens in place, the article — cover image, title, section, reading time, the stored Markdown with heading anchors, the verdict — and a rail with "On this page", the article's actions, and a pointer to the board. The actions are Copy as Markdown, Export (download the Markdown mirror or print to PDF), Open in chat (a prefilled prompt pointed at the Markdown mirror), and Connect to MCP (the board's help-center MCP endpoint, with copy-ready client commands). Below `xl` they ride under the "On this page" disclosure, or in an "Article actions" disclosure when the article has no outline. Previous/next stay inside the section. The rails render from the public list, so navigating between articles never unmounts them: sections the reader opened stay open while the next body loads.

**Widget.** The same documentation is a widget module (`help`) beside `feedback` and `updates`, for a customer who would rather read than post. Two endpoints serve it: `POST /api/widget/v1/help-center` lists every published article with its section, ordered by section then article, so the iframe groups them without a topic read; `POST /api/widget/v1/help-center/article` answers one article by slug, rendered to HTML through the cached pipeline the updates module uses, or `article: null` for a slug that is not published — a reader cannot tell a draft from a typo. Both answer `enabled: false` under the same conditions as the deflection below — and the list also answers it when nothing is readable, because the widget's tab is decided by that one value and an empty documentation page is worse than no tab. Archived articles travel with `isArchived`, like the portal's carrier: a withdrawn page still resolves and says it is out of date. A hub whose only remaining surface is one tab renders no tab bar, so a reader who landed on `/help` is moved to the first module that exists rather than being left on a page that will never fill; a single-module `help` embed keeps its own empty state, since there is nowhere else to send them.

## Search

Lexical first, semantic as a rescue. Two signals, one program (`help-center-article/hybrid-search.ts`), three surfaces.

**Lexical.** `help_center_article.search_vector` is a **generated** `tsvector` column — `setweight(title,'A') || setweight(excerpt,'B') || setweight(content,'C')` against `english` — with a GIN index. Generated rather than a trigger or a write-path update because the three inputs live on the same row, so Postgres can always compute the value and no caller can forget to; that also means no backfill and no drift from a restored dump or a bulk insert.

The query is built in `help-center-article/search.ts`, which is the only producer of the string `to_tsquery` ever parses. It lowercases, collapses whitespace, keeps runs of letters and digits, drops one-character terms and duplicates, caps the term count, and ORs prefix branches (`export:* | csv:*`). Nothing a reader types can reach the parser as syntax: `&`, `|`, `!`, `(`, `)`, `:` and `'` are separators before they are operators. Ranking is `ts_rank_cd`, so coverage beats a single passing mention, and the three weights decide title over summary over body.

**Semantic.** Articles carry an embedding (title + the first 6,000 characters of the body) written after every readable create or update, detached and best-effort — a model that is unreachable leaves the columns null and never fails the save. `searchByVector` orders by cosine distance and filters on `embedding_model` as well as `embedding is not null`: a vector from a different model lives in a different space, and comparing across models returns confident nonsense rather than an error.

**The rule that joins them.** The semantic pass runs only when the lexical pass returned fewer than three pages, and its hits are appended behind the lexical ones. It is a rescue, not a ranker: `ts_rank_cd` is unbounded and depends on the query's term count, cosine distance is bounded and model-specific, and any arithmetic combining them would be a constant nobody could defend. The rule also bounds cost — a public search box must not spend a model call on the common case, and the common case is a query that matches.

**The surfaces.** One difference between the dashboard and the portal: the dashboard includes every lifecycle state — an editor searching for the draft they half-wrote should find it — and the public one applies the same readable-state filter every other portal read applies. Getting that wrong publishes a draft through a search box, so the flag is a parameter of the repository call rather than something a caller can forget.

The widget's deflection passes `strict`, which restricts the lexical match to the title or summary **and disables the semantic pass**. A suggestion beside a feedback form is only worth showing if it names the thing being asked about; a semantic neighbour with no word overlap is exactly the suggestion that looks like a mistake there. It is also why the widget needs no embedding configuration.

## Agent surfaces

The article page is for a person; the same documentation has two machine surfaces beside it.

- **Markdown mirror.** `GET /help/articles/raw/<slug>.md` on a board host returns the stored body with the title, section, update date and canonical Markdown URL the page renders around it. The literal `raw` segment keeps the mirror out of the article's slug space, so an article whose slug is `api.md` is still served by its own HTML URL rather than shadowed by the mirror of `api`. It is the source rather than a serialization of the DOM, and it carries `X-Robots-Tag: noindex` so a copy never competes with the page in a search result. The response is browser-cacheable but `private`: there is no visibility-change purge, so a shared cache must not keep a mirror after the help center is hidden. The page's Open in chat action points an assistant at this URL.
- **MCP server.** `POST /mcp` on a board host is a keyless, read-only MCP server with two tools: `list_help_articles` (the index, grouped by section) and `get_help_article` (one article by slug, as Markdown). It is stateless Streamable HTTP and answers a single JSON body rather than an SSE stream. It refuses a cross-origin `Origin`, and it answers `404` when the feature flag is off or `site.help_center_visibility` is not `PUBLIC`, so the protocol cannot be used to probe a workspace that has not published documentation.

Both read through `ListHelpCenterArticlesPublic` and `GetHelpCenterArticlePublic`, which means the visibility gate, the published/archived filter and a draft's indistinguishable 404 are the same rules the portal applies. `noIndex` does not gate either surface: it is a crawler instruction, not a privacy switch, and the HTML page is still served to a reader.

## Analytics

The help center tab on the dashboard's insights page reads two day-bucketed tables over a 7, 30 or 90 day window. It lives there rather than on the help center index because it describes the documentation, while the help center pages manage it. A window of N days is N UTC dates **including today**, so its first day is `today - (N - 1)`; the boundary is pinned by a test that writes one bucket on the first included day and one on the day before it.

- `help_center_article_daily` counts views and verdicts per article per UTC day. The view counter moves inside the same transaction as the all-time counter, so the two cannot disagree. The verdict counters count verdicts **cast** that day, not the standing distribution — a flip adds an unhelpful to today and leaves the earlier helpful where it was. The standing distribution is the feedback table's own `count(*)`, and a second, slower-moving copy of it here would be a number that disagrees with the article page.
- `help_center_search_daily` counts searches and how many of them returned nothing, keyed on the normalized query. Both numbers live in one row so "what people look for" and "what we do not document" cannot disagree about how many searches there were.

Writes to either table are **advisory**: a failure is logged and swallowed, because a reader's search must not fail because an analytics write did, and a verdict must not be lost because its bucket was. The search write is the only public read that writes at all. A query with no searchable term — punctuation, or a box the reader cleared — is not recorded: it can never match, so counting it would put noise in both "top searches" and the gaps list.

## Widget deflection

Distinct from the module above: this is the hint beside the feedback form, not a surface a reader browses.

`POST /api/widget/v1/help-articles` answers `{ articles, enabled }` for the title being typed in the feedback composer. `enabled: false` covers every case where the surface does not exist — the deployment flag is off, the workspace hides its help center, or it has none — and is a value rather than an error on purpose: this endpoint is unauthenticated and names the workspace in its body, so a distinguishable failure would confirm which workspaces exist. The widget latches the flag and stops asking.

Each hit carries an absolute `url` built by `site/url.ts`, because the iframe is embedded on the customer's own origin and a relative link would resolve against the host page. That module is the single rule for `<custom domain>` or `<subdomain>.<root>`; the email outbox's portal links go through it too.

## Rollout

The feature ships behind `HELP_CENTER` in `packages/domain/src/feature-flags.ts`, default **off**. Unlike the audit log — where only the recorder is gated, since a read of an empty table is harmless — every operation is gated, because a read is as much a launch as a write when the tables are new and empty.

- `help-center/flag.ts` exposes `HelpCenterEnabled`, a `Context.Reference` defaulting to the flag. Tests provide `true`; production reads the default.
- `helpCenterFeatureGate` is a **public** policy (the portal has no session to check) that fails with `PolicyDeniedError`, which every operation already declares — so the flag adds no new error vocabulary at the RPC boundary. It is applied **last** in each handler's pipe, which makes it the outermost check: a deployment with the feature off refuses before it reads a row or spends a rate-limit token.
- The retention loop is forked only when the flag is on, matching the audit sweep: with the feature off nothing writes a read event or a search, so a daily pass would only wake the worker to delete nothing. The same loop prunes both tables — raw read events older than 90 days, and search buckets whose day is older than 90 days. The day comparison is `day < cutoff`, so the cut day itself survives; with a 90-day window and a 90-day analytics range that starts 89 days back, the sweep can never delete a bucket a panel still reports on.
- Every surface asks the same flag: the dashboard nav entry, the mobile tab, the settings section, the dashboard routes and the settings route (an "unavailable" state for a deep link, not a 404), the portal pages, the portal nav tab, `sitemap.xml`, `llms.txt`, and the article page's SSR metadata.

Turning it on is therefore a single-line change with no migration: no article can exist while the gate is closed, so `site.help_center_visibility` defaulting to `PUBLIC` cannot publish anything on the day the flag flips.

## Plan

`helpCenterArticles` is a `LimitFeatureKey`: free is **25**, Starter and Professional are `null` (uncapped). The feature is on every plan; the paid tiers remove the ceiling. Sections are not counted — a workspace at its article ceiling can still reorganise what it has.

## Not built

- **Fused ranking.** The two halves are ordered by precedence, not by a shared score. A learned ranker or a weighted fusion needs data that does not exist yet.
- **Re-embedding on a model switch.** Changing `EMBEDDING_MODEL` stops the semantic pass matching old rows until they are written again; there is no backfill sweep. Lexical search is unaffected, which is why the feature degrades quietly rather than breaking.
- **GitHub sync.** `help_center_article.source` reserves the provenance value. The link table, the sync rule, and the file front-matter contract belong to that feature.
- **Content translation.** The repo's i18n is chrome-only (Paraglide). A per-locale body is a product surface, not a column.
- **`llms.txt` for the help center.** The route precedent is `apps/web/src/routes/s/llms[.]txt.ts`; it reads published articles through the same public projection.
