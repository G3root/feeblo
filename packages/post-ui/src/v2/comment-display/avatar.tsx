import { UserAvatar } from "@feeblo/ui/user-avatar";

import { useCommentDisplay } from "./context";

export function CommentDisplayAvatar() {
  const { state } = useCommentDisplay();

  return <UserAvatar name={state.authorName} size="sm" />;
}
