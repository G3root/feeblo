import { Card } from "@feeblo/ui/card";
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

export function CommentDisplayComponent(props: CommentDisplayRootProps) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <CommentDisplayProvider
      {...props}
      isEditing={isEditing}
      onCancelEdit={() => setIsEditing(false)}
      onStartEdit={() => setIsEditing(true)}
    >
      <Card>
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
      </Card>
    </CommentDisplayProvider>
  );
}
