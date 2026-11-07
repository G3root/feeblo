import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import type {
  InsightsBoard,
  InsightsPoint,
  InsightsUntouchedPost,
  InsightsStatusSlice,
  InsightsTag,
  InsightsVoter,
} from "../atoms";

const numberFormatter = new Intl.NumberFormat();

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

const RELATIVE_UNITS: ReadonlyArray<
  readonly [Intl.RelativeTimeFormatUnit, number]
> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** "3 hours ago", "2 days ago", "just now". */
function formatRelativeTime(value: Date): string {
  const diffSeconds = Math.round((value.getTime() - Date.now()) / 1_000);

  for (const [unit, seconds] of RELATIVE_UNITS) {
    if (Math.abs(diffSeconds) >= seconds) {
      return relativeTimeFormatter.format(
        Math.round(diffSeconds / seconds),
        unit
      );
    }
  }

  return relativeTimeFormatter.format(diffSeconds, "second");
}

function plural(count: number, singular: string): string {
  return `${numberFormatter.format(count)} ${singular}${count === 1 ? "" : "s"}`;
}

/** A labelled number with one line of context underneath. */
export function InsightsStat({
  detail,
  label,
  value,
}: {
  readonly detail: string;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <Card size="sm">
      <CardPanel className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </span>
        <span className="text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </span>
        <span className="text-muted-foreground text-xs text-pretty">
          {detail}
        </span>
      </CardPanel>
    </Card>
  );
}

/**
 * One metric per day as a bar chart.
 *
 * Posts and votes get their own chart instead of sharing an axis: votes
 * outnumber posts by an order of magnitude on most boards, and a shared scale
 * would flatten the posts series into a line of dots. A chart per metric keeps
 * both readable without a dual-axis chart, which is easy to misread.
 */
export function InsightsVolumeChart({
  description,
  metric,
  points,
  title,
}: {
  readonly description: string;
  readonly metric: "posts" | "votes";
  readonly points: readonly InsightsPoint[];
  readonly title: string;
}) {
  // The caption reports the actual maximum; the bar scale keeps a nonzero
  // denominator so an inactive series renders as zeros instead of dividing by
  // zero.
  const peak = Math.max(0, ...points.map((point) => point[metric]));
  const scale = Math.max(1, peak);
  const firstDay = points[0]?.date;
  const lastDay = points.at(-1)?.date;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardPanel>
        <div
          aria-label={`${title}: ${firstDay} to ${lastDay}, peak ${peak}`}
          className="flex h-28 items-end gap-[2px]"
          role="img"
        >
          {points.map((point) => {
            const value = point[metric];

            return (
              <div
                className="bg-primary/30 hover:bg-primary/60 min-w-0 flex-1 rounded-t-[2px] transition-colors duration-150"
                key={point.date}
                style={{
                  height: `${(value / scale) * 100}%`,
                  minHeight: value > 0 ? 2 : 0,
                }}
                title={`${point.date}: ${value}`}
              />
            );
          })}
        </div>
        <div className="text-muted-foreground mt-2 flex items-center justify-between text-xs tabular-nums">
          <span>{firstDay}</span>
          <span>peak {numberFormatter.format(peak)}</span>
          <span>{lastDay}</span>
        </div>
        {/*
          The bars are a picture: their values live only in hover titles, which
          neither a keyboard nor a screen reader reaches. The disclosure is the
          same data as a real table, without changing the chart above it.
        */}
        <details className="mt-3">
          <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer text-xs underline-offset-4 transition-colors duration-150 hover:underline">
            Daily values
          </summary>
          <table className="mt-2 w-full text-xs">
            <caption className="sr-only">{title} by day, UTC</caption>
            <thead>
              <tr className="border-border text-muted-foreground border-b">
                <th className="py-1 text-left font-medium" scope="col">
                  Date
                </th>
                <th className="py-1 text-right font-medium" scope="col">
                  {metric === "posts" ? "Posts" : "Votes"}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.date}>
                  <th
                    className="py-1 text-left font-normal tabular-nums"
                    scope="row"
                  >
                    {point.date}
                  </th>
                  <td className="py-1 text-right tabular-nums">
                    {numberFormatter.format(point[metric])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </CardPanel>
    </Card>
  );
}

/** The current distribution of active posts across the workspace's statuses. */
export function InsightsStatusMix({
  activePosts,
  slices,
  unassignedPosts,
}: {
  readonly activePosts: number;
  readonly slices: readonly InsightsStatusSlice[];
  readonly unassignedPosts: number;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.posts, 0);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Status mix</CardTitle>
        <CardDescription>
          {plural(activePosts, "active post")},{" "}
          {numberFormatter.format(unassignedPosts)} unassigned
        </CardDescription>
      </CardHeader>
      <CardPanel className="flex flex-col gap-3">
        {total === 0 ? (
          <p className="text-muted-foreground text-sm">No active posts yet.</p>
        ) : (
          slices.map((slice) => {
            const share = total === 0 ? 0 : (slice.posts / total) * 100;
            const color = slice.color ?? undefined;

            return (
              <div
                className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5"
                key={slice.statusId}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="bg-muted-foreground size-2 shrink-0 rounded-full"
                    style={
                      color === undefined
                        ? undefined
                        : { backgroundColor: color }
                    }
                  />
                  <span className="truncate text-sm">{slice.label}</span>
                </div>
                <span className="text-sm tabular-nums">
                  {numberFormatter.format(slice.posts)}
                </span>
                <div className="bg-muted col-span-2 h-1.5 overflow-hidden rounded-full">
                  <div
                    className="bg-foreground/25 h-full rounded-full"
                    style={{
                      backgroundColor: color,
                      width: `${share}%`,
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </CardPanel>
    </Card>
  );
}

/** The posts nobody has assigned, answered, or commented on. */
export function InsightsUntouchedPosts({
  organizationId,
  posts,
}: {
  readonly organizationId: string;
  readonly posts: readonly InsightsUntouchedPost[];
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
        <CardDescription>
          Unassigned, unanswered, and uncommented — oldest first.
        </CardDescription>
      </CardHeader>
      <CardPanel>
        {posts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing is waiting. Every open post has an owner, a status change,
            or a comment.
          </p>
        ) : (
          <ul className="divide-border -mx-2 divide-y">
            {posts.map((post) => (
              <li key={post.id}>
                <Link
                  className="hover:bg-muted/60 ease-out-strong flex items-center justify-between gap-3 rounded-md px-2 py-2.5 transition-colors duration-150"
                  params={{
                    boardSlug: post.boardSlug,
                    organizationId,
                    postSlug: post.slug,
                  }}
                  to="/$organizationId/post/$boardSlug/$postSlug"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {post.title}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {post.boardName} · opened{" "}
                      {formatRelativeTime(post.createdAt)}
                    </span>
                  </span>
                  <HugeiconsIcon
                    className="text-muted-foreground size-4 shrink-0"
                    icon={ArrowRight01Icon}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardPanel>
    </Card>
  );
}

/** Boards ranked by the posts and votes they drew in the window. */
export function InsightsTopBoards({
  boards,
  organizationId,
}: {
  readonly boards: readonly InsightsBoard[];
  readonly organizationId: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Top boards</CardTitle>
        <CardDescription>Activity in this window.</CardDescription>
      </CardHeader>
      <CardPanel>
        {boards.length === 0 ? (
          <p className="text-muted-foreground text-sm">No boards yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {boards.map((board) => (
              <li
                className="flex items-center justify-between gap-3"
                key={board.id}
              >
                <Link
                  className="hover:text-foreground text-muted-foreground min-w-0 truncate text-sm transition-colors duration-150"
                  params={{ boardSlug: board.slug, organizationId }}
                  to="/$organizationId/board/$boardSlug"
                >
                  {board.name}
                </Link>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {plural(board.posts, "post")} · {plural(board.votes, "vote")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardPanel>
    </Card>
  );
}

/** Tags on the posts created in the window, by how many posts carry them. */
export function InsightsTopTags({
  tags,
}: {
  readonly tags: readonly InsightsTag[];
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Top tags</CardTitle>
        <CardDescription>What new feedback is about.</CardDescription>
      </CardHeader>
      <CardPanel>
        {tags.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No tagged posts in this window.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tags.map((tag) => (
              <li
                className="flex items-center justify-between gap-3"
                key={tag.id}
              >
                <span className="min-w-0 truncate text-sm">{tag.name}</span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {plural(tag.posts, "post")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardPanel>
    </Card>
  );
}

/** Voters ranked by how many votes they cast in the window. */
export function InsightsTopVoters({
  voters,
}: {
  readonly voters: readonly InsightsVoter[];
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Top voters</CardTitle>
        <CardDescription>Who is showing up in this window.</CardDescription>
      </CardHeader>
      <CardPanel>
        {voters.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No votes in this window.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {voters.map((voter, index) => (
              <li
                className="flex items-center justify-between gap-3"
                key={`${voter.name ?? "anonymous"}-${index}`}
              >
                <span
                  className={
                    voter.name === null
                      ? "text-muted-foreground min-w-0 truncate text-sm"
                      : "min-w-0 truncate text-sm"
                  }
                >
                  {voter.name ?? "Anonymous"}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {plural(voter.votes, "vote")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardPanel>
    </Card>
  );
}
