import { UserAvatar } from "@feeblo/ui/user-avatar";

import { m } from "../../paraglide/messages.js";
import { useCommentDisplay } from "./context";

export function CommentDisplayAvatar() {
  const { state } = useCommentDisplay();

  return (
    <UserAvatar
      isMember={state.authorIsMember}
      memberLabel={m.sad_soft_tadpole()}
      name={state.authorName}
      size="sm"
    />
  );
}
