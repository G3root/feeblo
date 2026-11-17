import { isFeatureEnabled } from "@feeblo/domain/feature-flags";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMachine } from "@xstate/react";
import { useEffect, useRef } from "react";

import {
  helpCenterVoteMachine,
  toHelpCenterVoteView,
  toVoteLoadedEvent,
  type HelpCenterVoteView,
} from "./vote-machine";

/** What the verdict widget needs from this hook. */
export type HelpCenterVote = HelpCenterVoteView & {
  /** Records a helpful verdict. */
  readonly markHelpful: () => void;
  /** Records an unhelpful verdict and opens the reason box. */
  readonly markUnhelpful: () => void;
  /** Sends the unhelpful verdict again, now carrying whatever was typed. */
  readonly sendReason: () => void;
  readonly closeReason: () => void;
  readonly setReason: (value: string) => void;
  readonly isPending: boolean;
  readonly counts: { readonly helpful: number; readonly notHelpful: number };
};

/**
 * The reader's verdict lifecycle, wired to the tally and the write.
 *
 * The graph lives in `vote-machine.ts`. This hook is the adapter: it loads the
 * tally, adopts it once per article, and sends the settle event the mutation
 * resolved to. The mutation is not an `invoke` inside the machine because its
 * failure belongs to React Query's `isError` and the caller's toast, not to a
 * fifth state — the machine tracks the reader's intent, and a reload re-derives
 * that intent from the server.
 */
export function useHelpCenterVote({
  articleId,
  organizationId,
  visitorId,
}: {
  articleId: string | undefined;
  organizationId: string;
  visitorId: string | undefined;
}): HelpCenterVote {
  const queryClient = useQueryClient();
  const [snapshot, send] = useMachine(helpCenterVoteMachine);

  const queryKey = [
    "portal-help-center-feedback",
    organizationId,
    articleId,
    visitorId,
  ] as const;

  const feedbackQuery = useQuery({
    // `visitorId` is part of the key, so a request sent before it resolves
    // would be thrown away and re-sent — one wasted round trip per article
    // view, and an answer that cannot say whether *this* reader voted.
    enabled:
      isFeatureEnabled("HELP_CENTER") &&
      articleId !== undefined &&
      visitorId !== undefined,
    queryKey,
    queryFn: () =>
      fetchRpc((rpc) =>
        rpc.GetHelpCenterArticleFeedbackPublic({
          organizationId,
          articleId: articleId ?? "",
          visitorId,
        })
      ),
  });

  const tally = feedbackQuery.data;

  /**
   * Adopt the server's verdict once per article.
   *
   * The tally arrives after mount, so `loading` has to be left by an event
   * rather than by the initial state. The guard is the article id, not the
   * tally object: a refetch returns the same verdict, and re-sending it would
   * yank a reader out of the reason box they are typing in.
   */
  const adoptedFor = useRef<string | null>(null);
  useEffect(() => {
    if (tally === undefined || articleId === undefined) {
      return;
    }

    if (adoptedFor.current === articleId) {
      return;
    }

    adoptedFor.current = articleId;
    send({ type: toVoteLoadedEvent(tally.mine) });
  }, [articleId, send, tally]);

  const vote = useMutation({
    mutationFn: (helpful: boolean) =>
      fetchRpc((rpc) =>
        rpc.SetHelpCenterArticleFeedback({
          organizationId,
          articleId: articleId ?? "",
          helpful,
          reason: helpful ? null : snapshot.context.reason.trim() || null,
          visitorId,
        })
      ),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next);
      send({
        type: next.mine === true ? "SETTLED_HELPFUL" : "SETTLED_UNHELPFUL",
      });
    },
  });

  const view = toHelpCenterVoteView(snapshot);

  return {
    ...view,
    counts: {
      helpful: tally?.helpfulCount ?? 0,
      notHelpful: tally?.notHelpfulCount ?? 0,
    },
    isPending: vote.isPending,
    reason: snapshot.context.reason,
    markHelpful: () => vote.mutate(true),
    // One mutation per press. The machine decides what the settle means: from
    // anywhere but the prompt it opens the box, and from the prompt it closes
    // it. Sending an open beforehand would give the box two ways to appear and
    // let the two disagree about whether a verdict had been recorded yet.
    markUnhelpful: () => vote.mutate(false),
    sendReason: () => vote.mutate(false),
    closeReason: () => send({ type: "CLOSE_REASON" }),
    setReason: (value: string) => send({ type: "SET_REASON", value }),
  };
}
