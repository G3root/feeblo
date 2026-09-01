import { Card } from "@feeblo/ui/card";
import { useState } from "react";

import { CommentDisplayActions } from "./actions";
import { CommentDisplayAvatar } from "./avatar";
import { CommentDisplayBody } from "./body";
import { CommentDisplayDropdown } from "./dropdown";
import { CommentDisplayHeader } from "./header";
import { CommentDisplayProvider } from "./provider";

import { useCommentDisplay } from "./context";

type CommentDisplayRootProps = Omit<
  React.ComponentProps<typeof CommentDisplayProvider>,
  "children"
> & {
  children?: never;
};

export function CommentDisplayComponent(props: CommentDisplayRootProps) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <CommentDisplayProvider
      {...props}
      isEditing={isEditing}
      onCancelEdit={() => setIsEditing(false)}
      onStartEdit={() => setIsEditing(true)}
    >
      <PinnedCardWrapper>
        <div className="flex items-start gap-3 p-4">
          <CommentDisplayAvatar />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between">
              <CommentDisplayHeader />
              <CommentDisplayDropdown />
            </div>
            <CommentDisplayBody />
            <CommentDisplayActions />
          </div>
        </div>
      </PinnedCardWrapper>
    </CommentDisplayProvider>
  );
}

function PinnedCardWrapper({ children }: { children: React.ReactNode }) {
  const { state } = useCommentDisplay();
  if (state.pinnedAt != null) {
    return (
      <Card className="border-amber-300 bg-amber-50/50 shadow-sm ring-1 ring-amber-200 dark:border-amber-800 dark:bg-amber-950/20 dark:ring-amber-900">
        <div className="flex items-center gap-1.5 border-b border-amber-200 bg-amber-100/70 px-3 py-1.5 text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          <PinnedIcon />
          Pinned
        </div>
        {children}
      </Card>
    );
  }
  return <Card>{children}</Card>;
}

function PinnedIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
      <path d="M12 15v6" />
      <path d="M9 21h6" />
    </svg>
  );
}
