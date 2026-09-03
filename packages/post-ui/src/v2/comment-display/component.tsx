import { useState } from "react";

import { CommentDisplayActions } from "./actions";
import { CommentDisplayAvatar } from "./avatar";
import { CommentDisplayBody } from "./body";
import { CommentDisplayDropdown } from "./dropdown";
import { CommentDisplayHeader } from "./header";
import { CommentDisplayProvider } from "./provider";

type CommentDisplayRootProps = Omit<
  React.ComponentProps<typeof CommentDisplayProvider>,
  "children"
> & {
  children?: never;
};

/**
 * Minimal, dense comment row: no card chrome — just avatar, header, body and
 * actions. The row is a hover `group` so the overflow menu can reveal itself
 * on desktop; `data-slot="comment"` gives tests and consumers a stable hook.
 */
export function CommentDisplayComponent(props: CommentDisplayRootProps) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <CommentDisplayProvider
      {...props}
      isEditing={isEditing}
      onCancelEdit={() => setIsEditing(false)}
      onStartEdit={() => setIsEditing(true)}
    >
      <div className="group flex items-start gap-2 py-1.5" data-slot="comment">
        <CommentDisplayAvatar />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <CommentDisplayHeader />
            <CommentDisplayDropdown />
          </div>
          <CommentDisplayBody />
          <CommentDisplayActions />
        </div>
      </div>
    </CommentDisplayProvider>
  );
}
