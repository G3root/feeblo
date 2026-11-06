import { Button } from "@feeblo/ui/button";
import { Menu, MenuPopup, MenuTrigger } from "@feeblo/ui/menu";
import { Ellipsis } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { m } from "../paraglide/messages.js";
import { usePostCollectionData } from "../post-page-context";
import { BanAuthorButton } from "./ban-author-button";
import { useCommentDisplay } from "./context";
import { DeleteButton } from "./delete-button";
import { EditButton } from "./edit-button";
import { PinButton } from "./pin-button";
import { ToggleVisibilityButton } from "./toggle-visibility-button";
import { UnbanAuthorButton } from "./unban-author-button";

export function CommentDisplayDropdown() {
  const { canBanAuthors, canModeratePost, canUnbanAuthors } =
    usePostCollectionData();
  const { state } = useCommentDisplay();

  if (state.disabled || !(canModeratePost || state.isAuthor)) {
    return null;
  }

  // A ban is for end users: staff are managed through membership, and the
  // server refuses a member target for the same reason. Offering it again for
  // somebody already banned would only re-upsert the row; that author gets the
  // unban action instead.
  const canBanAuthor =
    canBanAuthors && !state.authorIsMember && !state.authorIsBanned;
  const canUnbanAuthor =
    canUnbanAuthors && !state.authorIsMember && state.authorIsBanned;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={m.equal_sound_lark()}
            className="transition-opacity data-popup-open:opacity-100 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
            size="icon-sm"
            variant="ghost"
          >
            <HugeiconsIcon icon={Ellipsis} />
          </Button>
        }
      />
      <MenuPopup>
        {state.isAuthor ? <EditButton /> : null}
        {state.isAuthor ? <ToggleVisibilityButton /> : null}
        {canModeratePost ? <PinButton /> : null}
        <DeleteButton />
        {canBanAuthor ? <BanAuthorButton /> : null}
        {canUnbanAuthor ? <UnbanAuthorButton /> : null}
      </MenuPopup>
    </Menu>
  );
}
