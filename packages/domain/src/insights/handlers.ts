import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { InsightsRepository } from "./repository";
import { InsightsRpcs } from "./rpcs";
import { INSIGHTS_RANGE_DAYS, type TInsightsPayload } from "./schema";

/** How many untouched posts the page lists before it stops being a list. */
const UNTOUCHED_POST_LIMIT = 5;

export const InsightsRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* InsightsRepository;

  return {
    GetWorkspaceInsights: (args: TInsightsPayload) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        // Start of the first day, not "now minus N days": the chart's last
        // bucket is today and partial, so a 7-day range is today plus the six
        // days before it. A rolling 168-hour window would produce eight daily
        // buckets for a switch that says "7 days".
        const since = DateTime.startOf(
          DateTime.subtract({
            days: INSIGHTS_RANGE_DAYS[args.range] - 1,
          })(now),
          "day"
        );
        const sinceDate = DateTime.toDate(since);
        const untilDate = DateTime.toDate(now);

        // One snapshot, not nine reads that can disagree with each other.
        const reads = yield* repository.readWindow({
          organizationId: args.organizationId,
          since: sinceDate,
          until: untilDate,
          limit: UNTOUCHED_POST_LIMIT,
        });

        return {
          range: args.range,
          since: sinceDate,
          until: untilDate,
          summary: {
            ...reads.summary,
            respondedPosts: reads.firstResponse.respondedPosts,
            medianFirstResponseSeconds:
              reads.firstResponse.medianFirstResponseSeconds,
            // A rate over zero posts has no value; zero would read as "nothing
            // was merged", which is a claim this window cannot make.
            mergeRate:
              reads.summary.posts === 0
                ? null
                : reads.summary.mergedPosts / reads.summary.posts,
          },
          // The sql client types a result's rows as readonly; the response
          // schema's arrays are mutable, and the extra copy is a page's worth
          // of a few dozen rows.
          volume: [...reads.volume.rows],
          statusMix: reads.statusMix,
          untouchedPosts: [...reads.untouchedPosts.rows],
          topBoards: [...reads.topBoards.rows],
          topTags: [...reads.topTags.rows],
          topVoters: [...reads.topVoters.rows],
          subscriptions: reads.subscriptions,
        };
      }).pipe(
        Policy.withPolicy(Policy.hasMembership(args.organizationId)),
        withRemapDbErrors("Insights", "select")
      ),
  };
});

export const InsightsRpcHandlers = InsightsRpcs.toLayer(
  InsightsRpcHandlersEffect
).pipe(Layer.provide(InsightsRepository.layer));
