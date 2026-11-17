import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useMachine } from "@xstate/react";
import * as Result from "effect/reactivity/AsyncResult";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  helpCenterArticleFeedbackAtom,
  helpCenterPublicReactivityKeys,
  setHelpCenterArticleFeedbackAtom,
  type HelpCenterFeedbackAtomArgs,
} from "./atoms";
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
 * The graph lives in `vote-machine.ts`. This hook is the adapter: it reads the
 * tally from an atom, adopts it once per article, and sends the settle event
 * the write resolved to.
 *
 * The write carries the tally's reactivity keys, which is what replaced React
 * Query's `setQueryData`: the atom refreshes itself, so the widget never writes
 * a cache it does not own. The machine holds the reader's intent, so the button
 * state does not wait for a cache mutation to look right.
 */
export function useHelpCenterVote({
  articleId,
  organizationId,
  visitorId,
}: {
  /** Both are known before the widget renders; see the page's gate. */
  articleId: string;
  organizationId: string;
  visitorId: string;
}): HelpCenterVote {
  const [snapshot, send] = useMachine(helpCenterVoteMachine);

  /**
   * Memoized because `Atom.family` keys on identity, and the key includes the
   * visitor id: `mine` is part of the answer, so two readers must not share an
   * entry.
   */
  const tallyArgs = useMemo<HelpCenterFeedbackAtomArgs>(
    () => ({ articleId, organizationId, visitorId }),
    [articleId, organizationId, visitorId]
  );

  const feedbackResult = useAtomValue(helpCenterArticleFeedbackAtom(tallyArgs));

  const tally = Result.getOrElse(
    feedbackResult,
    (): {
      helpfulCount: number;
      mine: boolean | null;
      notHelpfulCount: number;
    } | null => null
  );

  /**
   * Adopt the server's verdict once per article.
   *
   * The tally arrives after mount, so `loading` has to be left by an event
   * rather than by the initial state. The guard is the article id, not the
   * tally: a refetch returns the same verdict, and re-sending it would yank a
   * reader out of the reason box they are typing in.
   */
  const adoptedFor = useRef<string | null>(null);
  useEffect(() => {
    if (tally === null) {
      return;
    }

    if (adoptedFor.current === articleId) {
      return;
    }

    adoptedFor.current = articleId;
    send({ type: toVoteLoadedEvent(tally.mine) });
  }, [articleId, send, tally]);

  const setFeedback = useAtomSet(setHelpCenterArticleFeedbackAtom, {
    mode: "promise",
  });

  /**
   * Whether a write is in flight.
   *
   * The machine tracks the reader's intent, not the transport, so this is the
   * one thing it deliberately does not model: it exists to disable the buttons
   * while a press is on its way, not to describe a state the reader can see.
   */
  const [isPending, setIsPending] = useState(false);

  const cast = (helpful: boolean) => {
    setIsPending(true);

    void setFeedback({
      payload: {
        organizationId,
        articleId,
        helpful,
        reason: helpful ? null : snapshot.context.reason.trim() || null,
        visitorId,
      },
      reactivityKeys: helpCenterPublicReactivityKeys(organizationId),
    })
      .then(() =>
        send({
          type: helpful ? "SETTLED_HELPFUL" : "SETTLED_UNHELPFUL",
        })
      )
      .catch(() => {
        // The verdict is a count, not a document: a refused write leaves the
        // machine where it is and the reader can press again. A toast for this
        // would outlive the press that caused it.
      })
      .finally(() => setIsPending(false));
  };

  const view = toHelpCenterVoteView(snapshot);

  return {
    ...view,
    counts: {
      helpful: tally?.helpfulCount ?? 0,
      notHelpful: tally?.notHelpfulCount ?? 0,
    },
    isPending,
    markHelpful: () => cast(true),
    // One write per press. The machine decides what the settle means: from
    // anywhere but the prompt it opens the box, and from the prompt it closes
    // it. Opening it beforehand would give the box two ways to appear and let
    // the two disagree about whether a verdict had been recorded yet.
    markUnhelpful: () => cast(false),
    sendReason: () => cast(false),
    closeReason: () => send({ type: "CLOSE_REASON" }),
    setReason: (value: string) => send({ type: "SET_REASON", value }),
  };
}
