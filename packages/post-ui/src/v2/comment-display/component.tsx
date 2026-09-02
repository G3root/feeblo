import { Card } from "@feeblo/ui/card";
import { useState } from "react";

import { CommentDisplayActions } from "./actions";
import { CommentDisplayAvatar } from "./avatar";
import { CommentDisplayBody } from "./body";
import { useCommentDisplay } from "./context";
import { CommentDisplayDropdown } from "./dropdown";
import { CommentDisplayHeader } from "./header";
import { CommentDisplayProvider } from "./provider";

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
        {children}
      </Card>
    );
  }
  return <Card>{children}</Card>;
}
