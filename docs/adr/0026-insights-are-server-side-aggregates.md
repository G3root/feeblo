# ADR 0026: Insights are server-side aggregates, not collections

## Decision

The dashboard's insights page is one RPC, `GetWorkspaceInsights`, that returns every number the page renders for one window (`7d`, `30d`, `90d`). The domain module is `packages/domain/src/insights/`: `schema.ts` for the response, `repository.ts` for the aggregates, `rpcs.ts` and `handlers.ts` for the operation, and no policies beyond membership.

The aggregates run in the database and are read concurrently. The page does not build its numbers from the dashboard's TanStack DB collections.

The page is dashboard-only. It is not a Public API operation and has no MCP projection in v1.

Six definitions are part of the contract because a number nobody can define is a number two people will read differently:

- **Windowed vs current.** Created posts, cast votes, and `POST_MERGED` activities are counted inside the window. Active posts, unassigned posts, the status mix, untouched posts, and follower counts describe the workspace as it is now; a status mix over "posts created in the last 7 days" would hide the backlog the page exists to show.
- **First response** is the first `STATUS_CHANGED` activity on a post. The median is over posts created in the window that have one, and `respondedPosts` is returned beside it. An unanswered post is not a zero-second response.
- **Untouched post** is an active post with no assignee, no status change, and no comment. It is not an `updated_at` comparison: editing a title is not a decision, and a post whose body was fixed should not leave the list. The list is current state, not window state, so the oldest ignored post does not disappear because it is older than the range.
- **Merge rate** is `POST_MERGED` activities in the window divided by posts created in the window. It is null when the window has no posts; zero would claim that nothing was merged.
- **Day buckets are UTC.** A workspace has no time zone, so a local-day bucket would make the same request return different totals depending on which process answered it. The window starts at the beginning of the first day, so a 7-day range is today plus the six days before it — seven points, not eight, for a switch that says "7 days". A day with no activity is a zero row, because a missing day and a zero are different facts and a chart should not have to guess.
- **Status mix includes every status**, including one with no posts, and falls back to the status type when the workspace has not named it — the same fallback the rest of the dashboard uses.

There is no migration. Every number is derived from `post`, `upvote`, `comment`, `post_activity`, `post_tag`, `post_subscription`, and `changelog_subscription` as they are today.

## Why

`docs/missing-features-research.md` §2 identified the missing reporting surface: the dashboard home computes boards, recent posts, and upvote counts from client collections, and that was the entire reporting surface. The research proposed server-side aggregates rather than collections, and this records why that is the right seam.

The dashboard's collections are row lists the browser can filter and join. That is the correct shape for the feedback list, whose rows the user scrolls. It is the wrong shape for `GROUP BY date_trunc(...)` over a workspace's whole history: the browser would download every post and vote to produce a handful of sums, the page's cost would grow with the workspace, and the answer for a 90-day window would depend on how much of the collection had synced.

One operation per page load rather than one per metric also keeps the round trips constant. The metrics share a window and a workspace, so the handler reads them together, and adding a metric changes one schema and one query rather than the page's request graph.

The Public API is deliberately excluded (ADR 0004). Its DTOs are a versioned contract; an aggregate whose definition will change as the product learns what it wants is a poor thing to freeze. Adding it later is additive, and the dashboard's schema is not the contract it would reuse.

Day buckets are UTC because the alternative is a workspace setting that does not exist yet. Introducing a per-workspace time zone is a product decision with its own migration and consent questions; until then, a deterministic UTC bucket is the honest one, and the chart says so.

## Consequences

- Every insight query is scoped by `organization_id` and filtered by `created_at`; the only new load is a range scan the existing indexes on `post`, `upvote`, and `post_activity` answer at today's sizes. A workspace large enough to feel it gets a rollup table behind the same repository method, not a different RPC.
- The response carries current-state numbers and window numbers in one object. They share a timestamp (`until`), so "active now" cannot drift from "created in the window" between two requests.
- Plan gating is not part of v1. The research proposes an `analytics` capability for Starter and above, which touches `packages/domain/src/plan-entitlements.ts` and the pricing copy; that is an owner decision, so the page ships for every plan until it is made.
- Views, email open/click, and per-post trends are not in v1. Views need a privacy decision and a volume write on every read, and open/click is a deliverability signal with the same problem. Neither should be bolted onto a read-only page.
- The page is read-only and there is nothing to invalidate: the atom's reactivity key covers the workspace, and the 60-second stale window is the only freshness contract.
