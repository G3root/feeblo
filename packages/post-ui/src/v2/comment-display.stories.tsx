import "../../tailwind.css";
import {
  ActivityTimeline,
  ActivityTimelineItem,
} from "@feeblo/ui/activity-timeline";
import { CommentAdd01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { CommentDisplay } from "./comment-display";

export default {
  title: "V2 / CommentDisplay",
};

const SAMPLE_HTML =
  "<p>This is a sample comment with <strong>bold</strong> text and a <a href='#'>link</a>.</p>";

const SAMPLE_MARKDOWN =
  "This is a sample comment with **bold** text and a [link](https://example.com).";

const noopReply = async () => true;

export function Default() {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-xl">
        <CommentDisplay
          authorName="Jane Smith"
          commentId="1"
          content={SAMPLE_HTML}
          createdAt={new Date(Date.now() - 1000 * 60 * 30)}
          onDelete={() => {}}
          onReply={noopReply}
          postId="post-1"
          postSlug="post-1"
        />
      </div>
    </div>
  );
}

export function InternalNote() {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-xl">
        <CommentDisplay
          authorName="John Doe"
          commentId="2"
          content="<p>This is an internal note visible only to team members.</p>"
          createdAt={new Date(Date.now() - 1000 * 60 * 60)}
          isInternal
          onDelete={() => {}}
          onReply={noopReply}
          postId="post-1"
          postSlug="post-1"
        />
      </div>
    </div>
  );
}

export function AsAuthor() {
  const [content, setContent] = useState(SAMPLE_MARKDOWN);
  const [isInternal, setIsInternal] = useState(false);

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-xl">
        <CommentDisplay
          authorName="You"
          commentId="3"
          content={content}
          createdAt={new Date(Date.now() - 1000 * 60 * 5)}
          isInternal={isInternal}
          onDelete={() => {
            console.log("Delete comment");
          }}
          onReply={async ({ content, isPrivate }) => {
            console.log("Reply", { content, isPrivate });
            return true;
          }}
          onToggleVisibility={() => setIsInternal((prev) => !prev)}
          onUpdate={({ content }) => {
            console.log("Update comment", content);
            setContent(content);
          }}
          postId="post-1"
          postSlug="post-1"
        />
      </div>
    </div>
  );
}

export function WithReactions() {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-xl">
        <CommentDisplay
          authorName="Alice Johnson"
          commentId="4"
          content={SAMPLE_HTML}
          createdAt={new Date(Date.now() - 1000 * 60 * 60 * 3)}
          onDelete={() => {}}
          onReply={noopReply}
          postId="post-1"
          postSlug="post-1"
        />
      </div>
    </div>
  );
}

export function Disabled() {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-xl">
        <CommentDisplay
          authorName="Bob Williams"
          commentId="5"
          content={SAMPLE_HTML}
          createdAt={new Date(Date.now() - 1000 * 60 * 60 * 12)}
          disabled
          onDelete={() => {}}
          onReply={noopReply}
          postId="post-1"
          postSlug="post-1"
        />
      </div>
    </div>
  );
}

export function Composed() {
  const [isInternal, setIsInternal] = useState(false);

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-xl">
        <CommentDisplay.Provider
          authorName="Charlie Brown"
          commentId="6"
          content={SAMPLE_HTML}
          createdAt={new Date(Date.now() - 1000 * 60 * 60 * 2)}
          isInternal={isInternal}
          onDelete={() => {
            console.log("Delete comment");
          }}
          onReply={async ({ content, isPrivate }) => {
            console.log("Reply", { content, isPrivate });
            return true;
          }}
          onToggleVisibility={() => setIsInternal((prev) => !prev)}
          onUpdate={({ content, isPrivate }) => {
            console.log("Update comment", { content, isPrivate });
          }}
          postId="post-1"
          postSlug="post-1"
        >
          <div className="border-border rounded-md border p-4">
            <div className="flex items-start gap-3">
              <CommentDisplay.Avatar />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between">
                  <CommentDisplay.Header />
                  <CommentDisplay.Dropdown />
                </div>
                <CommentDisplay.Body />
                <CommentDisplay.Actions />
              </div>
            </div>
          </div>
        </CommentDisplay.Provider>
      </div>
    </div>
  );
}

export function TimelineComposition() {
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
    <div className="bg-background flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-xl">
        <ActivityTimeline>
          {comments.map((comment) => (
            <ActivityTimelineItem
              icon={
                <HugeiconsIcon
                  aria-hidden="true"
                  className="text-muted-foreground size-3.5"
                  icon={CommentAdd01Icon}
                  strokeWidth={2}
                />
              }
              key={comment.commentId}
            >
              <span className="text-foreground font-medium">
                {comment.authorName}
              </span>{" "}
              {formatRelativeTime(comment.createdAt)}
              <CommentDisplay
                authorName={comment.authorName}
                commentId={comment.commentId}
                content={comment.content}
                createdAt={comment.createdAt}
                isInternal={internalComments.has(comment.commentId)}
                onDelete={() => {
                  console.log(`Delete ${comment.commentId}`);
                }}
                onReply={async ({ content, isPrivate }) => {
                  console.log(`Reply to `, {
                    content,
                    isPrivate,
                  });
                  return true;
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
                onUpdate={({ content }) => {
                  console.log(`Update ${comment.commentId}`, content);
                }}
                postId="post-1"
                postSlug="post-1"
              />
            </ActivityTimelineItem>
          ))}
        </ActivityTimeline>
      </div>
    </div>
  );
}

export function StatusUpdate() {
  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-xl">
        <CommentDisplay
          authorName="Jane Smith"
          commentId="4"
          content={SAMPLE_HTML}
          createdAt={new Date(Date.now() - 1000 * 60 * 15)}
          onDelete={() => {}}
          onReply={noopReply}
          postId="post-1"
          postSlug="post-1"
          statusUpdateType="COMPLETED"
        />
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
