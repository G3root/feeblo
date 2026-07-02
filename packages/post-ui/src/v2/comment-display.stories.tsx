import "../../tailwind.css";
import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from "@feeblo/ui/reui/timeline";
import type { ReactionEmoji } from "@feeblo/utils/reaction";
import { useState } from "react";
import { CommentDisplay } from "./comment-display";

export default {
  title: "V2 / CommentDisplay",
};

const SAMPLE_HTML =
  "<p>This is a sample comment with <strong>bold</strong> text and a <a href='#'>link</a>.</p>";

const SAMPLE_REACTIONS = new Map<ReactionEmoji, { count: number }>([
  ["red_heart", { count: 5 }],
  ["thumbs_up", { count: 3 }],
  ["party_popper", { count: 1 }],
]);

export function Default() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <CommentDisplay
          authorName="Jane Smith"
          commentId="1"
          content={SAMPLE_HTML}
          createdAt={new Date(Date.now() - 1000 * 60 * 30)}
          onDelete={() => {}}
          onReply={() => {}}
          onToggleReaction={() => {}}
          reactionList={new Map()}
          selectedReactions={new Set()}
        />
      </div>
    </div>
  );
}

export function InternalNote() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <CommentDisplay
          authorName="John Doe"
          commentId="2"
          content="<p>This is an internal note visible only to team members.</p>"
          createdAt={new Date(Date.now() - 1000 * 60 * 60)}
          isInternal
          onDelete={() => {}}
          onReply={() => {}}
          onToggleReaction={() => {}}
          reactionList={new Map()}
          selectedReactions={new Set()}
        />
      </div>
    </div>
  );
}

export function AsAuthor() {
  const [isInternal, setIsInternal] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <CommentDisplay
          authorName="You"
          commentId="3"
          content={SAMPLE_HTML}
          createdAt={new Date(Date.now() - 1000 * 60 * 5)}
          isInternal={isInternal}
          onDelete={() => {
            // biome-ignore lint/suspicious/noConsole: story demo
            console.log("Delete comment");
          }}
          onEdit={() => {
            // biome-ignore lint/suspicious/noConsole: story demo
            console.log("Edit comment");
          }}
          onReply={() => {}}
          onToggleReaction={() => {}}
          onToggleVisibility={() => setIsInternal((prev) => !prev)}
          reactionList={SAMPLE_REACTIONS}
          selectedReactions={new Set()}
        />
      </div>
    </div>
  );
}

export function WithReactions() {
  const [selected, setSelected] = useState<Set<ReactionEmoji>>(new Set());

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <CommentDisplay
          authorName="Alice Johnson"
          commentId="4"
          content={SAMPLE_HTML}
          createdAt={new Date(Date.now() - 1000 * 60 * 60 * 3)}
          onDelete={() => {}}
          onReply={() => {}}
          onToggleReaction={(emoji) => {
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(emoji)) {
                next.delete(emoji);
              } else {
                next.add(emoji);
              }
              return next;
            });
          }}
          reactionList={SAMPLE_REACTIONS}
          selectedReactions={selected}
        />
      </div>
    </div>
  );
}

export function Disabled() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <CommentDisplay
          authorName="Bob Williams"
          commentId="5"
          content={SAMPLE_HTML}
          createdAt={new Date(Date.now() - 1000 * 60 * 60 * 12)}
          disabled
          onDelete={() => {}}
          onReply={() => {}}
          onToggleReaction={() => {}}
          reactionList={SAMPLE_REACTIONS}
          selectedReactions={new Set()}
        />
      </div>
    </div>
  );
}

export function Composed() {
  const [selected, setSelected] = useState<Set<ReactionEmoji>>(new Set());
  const [isInternal, setIsInternal] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <CommentDisplay.Provider
          authorName="Charlie Brown"
          commentId="6"
          content={SAMPLE_HTML}
          createdAt={new Date(Date.now() - 1000 * 60 * 60 * 2)}
          isInternal={isInternal}
          onDelete={() => {
            // biome-ignore lint/suspicious/noConsole: story demo
            console.log("Delete comment");
          }}
          onEdit={() => {
            // biome-ignore lint/suspicious/noConsole: story demo
            console.log("Edit comment");
          }}
          onReply={() => {}}
          onToggleReaction={(emoji) => {
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(emoji)) {
                next.delete(emoji);
              } else {
                next.add(emoji);
              }
              return next;
            });
          }}
          onToggleVisibility={() => setIsInternal((prev) => !prev)}
          reactionList={SAMPLE_REACTIONS}
          selectedReactions={selected}
        >
          <div className="rounded-md border border-border p-4">
            <div className="flex items-start gap-3">
              <CommentDisplay.Avatar />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between">
                  <CommentDisplay.Header />
                  <CommentDisplay.Dropdown />
                </div>
                <CommentDisplay.Body />
                <CommentDisplay.Actions />
                <CommentDisplay.Reactions />
              </div>
            </div>
          </div>
        </CommentDisplay.Provider>
      </div>
    </div>
  );
}

export function TimelineComposition() {
  const [selected, setSelected] = useState<Set<ReactionEmoji>>(new Set());
  const [internalComments, setInternalComments] = useState<Set<string>>(
    new Set(["c3"])
  );

  const comments = [
    {
      authorName: "Jane Smith",
      commentId: "c1",
      content:
        "<p>Great idea! I think this would work well for the new feature.</p>",
      createdAt: new Date(Date.now() - 1000 * 60 * 15),
    },
    {
      authorName: "John Doe",
      commentId: "c2",
      content:
        "<p>I have some concerns about the timeline. Let me elaborate in the design doc.</p>",
      createdAt: new Date(Date.now() - 1000 * 60 * 90),
    },
    {
      authorName: "Alice Johnson",
      commentId: "c3",
      content:
        "<p>This is an <strong>internal note</strong> with additional details on the implementation approach.</p>",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5),
    },
    {
      authorName: "You",
      commentId: "c4",
      content:
        "<p>Thanks everyone! I've updated the spec based on the feedback.</p>",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
    },
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-xl">
        <Timeline>
          {comments.map((comment, index) => (
            <TimelineItem key={comment.commentId} step={index + 1}>
              <TimelineIndicator />
              <TimelineSeparator />
              <TimelineHeader>
                <TimelineDate>
                  {formatRelativeTime(comment.createdAt)}
                </TimelineDate>
                <TimelineTitle>{comment.authorName}</TimelineTitle>
              </TimelineHeader>
              <TimelineContent>
                <CommentDisplay
                  authorName={comment.authorName}
                  commentId={comment.commentId}
                  content={comment.content}
                  createdAt={comment.createdAt}
                  isInternal={internalComments.has(comment.commentId)}
                  onDelete={() => {
                    // biome-ignore lint/suspicious/noConsole: story demo
                    console.log(`Delete ${comment.commentId}`);
                  }}
                  onEdit={() => {
                    // biome-ignore lint/suspicious/noConsole: story demo
                    console.log(`Edit ${comment.commentId}`);
                  }}
                  onReply={() => {}}
                  onToggleReaction={(emoji) => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(emoji)) {
                        next.delete(emoji);
                      } else {
                        next.add(emoji);
                      }
                      return next;
                    });
                  }}
                  onToggleVisibility={() => {
                    setInternalComments((prev) => {
                      const next = new Set(prev);
                      if (next.has(comment.commentId)) {
                        next.delete(comment.commentId);
                      } else {
                        next.add(comment.commentId);
                      }
                      return next;
                    });
                  }}
                  reactionList={
                    index === 0
                      ? new Map([
                          ["red_heart", { count: 5 }],
                          ["thumbs_up", { count: 2 }],
                        ])
                      : new Map()
                  }
                  selectedReactions={selected}
                />
              </TimelineContent>
            </TimelineItem>
          ))}
        </Timeline>
      </div>
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  const diffSeconds = Math.round(diffMs / 1000);
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (Math.abs(diffSeconds) < 60) {
    return rtf.format(diffSeconds, "second");
  }
  if (Math.abs(diffMinutes) < 60) {
    return rtf.format(diffMinutes, "minute");
  }
  if (Math.abs(diffHours) < 24) {
    return rtf.format(diffHours, "hour");
  }
  return rtf.format(diffDays, "day");
}
