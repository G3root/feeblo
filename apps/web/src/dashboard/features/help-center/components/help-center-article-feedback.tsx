import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { THelpCenterArticleFeedback } from "@feeblo/domain/help-center-article-feedback/schema";
import { Button } from "@feeblo/ui/button";
import { Skeleton } from "@feeblo/ui/skeleton";
import * as dayjs from "@feeblo/utils/dayjs";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import * as Result from "effect/reactivity/AsyncResult";

import { helpCenterArticleFeedbackReasonsAtom } from "../atoms";

/**
 * The unhelpful votes that left a reason, newest first.
 *
 * A manager's panel, not a reader's: the list names what the documentation
 * failed to answer, and the permission gate is the server's own
 * `helpCenterArticles.update`. It is a preview — ten rows, no pagination — so it
 * sits in the editor's sidebar and asks the question "what should I fix?"
 * rather than becoming a review queue of its own.
 *
 * The gate and the read are two components so the read's hooks always run in
 * the same order for this component: the panel appears when the policy
 * resolves, and disappears the same way, without the parent changing the
 * number of hooks it calls.
 */
export function HelpCenterArticleFeedback({
  articleId,
  organizationId,
}: {
  articleId: string;
  organizationId: string;
}) {
  const { allowed: canReview } = usePolicy(
    hasPermission(organizationId, "helpCenterArticles.update")
  );

  if (!canReview) {
    return null;
  }

  return (
    <FeedbackReasons articleId={articleId} organizationId={organizationId} />
  );
}

function FeedbackReasons({
  articleId,
  organizationId,
}: {
  articleId: string;
  organizationId: string;
}) {
  // The atom family keys on both ids by value, so a fresh literal is the same
  // atom rather than a request per render.
  const atom = helpCenterArticleFeedbackReasonsAtom({
    articleId,
    organizationId,
  });

  const result = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);

  return (
    <section aria-labelledby="help-center-article-feedback-heading">
      <h2
        className="mb-2 text-sm font-medium"
        id="help-center-article-feedback-heading"
      >
        Reader feedback
      </h2>
      {Result.builder(result)
        .onInitial(() => (
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
          </div>
        ))
        .onFailure(() => (
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs">
              Could not load reader feedback.
            </p>
            <Button onClick={refresh} size="xs" type="button" variant="outline">
              Retry
            </Button>
          </div>
        ))
        .onSuccess((entries) =>
          entries.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No unhelpful votes with a reason yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {entries.map((entry) => (
                <FeedbackEntry entry={entry} key={entry.id} />
              ))}
            </ul>
          )
        )
        .exhaustive()}
    </section>
  );
}

function FeedbackEntry({ entry }: { entry: THelpCenterArticleFeedback }) {
  return (
    <li className="space-y-1 border-l-2 pl-2.5">
      {/* Free text, rendered as text: this path has no Markdown renderer, and
          sanitizing it would imply one. */}
      <p className="text-xs break-words whitespace-pre-wrap">{entry.reason}</p>
      <p className="text-muted-foreground text-[11px]">
        {entry.authorName ?? "Anonymous"} ·{" "}
        <time dateTime={entry.createdAt.toISOString()}>
          {dayjs.default(entry.createdAt).fromNow()}
        </time>
      </p>
    </li>
  );
}
