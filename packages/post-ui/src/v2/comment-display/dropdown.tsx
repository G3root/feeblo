import { Button } from "@feeblo/ui/button";
import { Menu, MenuPopup, MenuTrigger } from "@feeblo/ui/menu";
import { Ellipsis } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { m } from "../../paraglide/messages.js";
import { usePostCollectionData } from "../post-page-context";
import { useCommentDisplay } from "./context";
import { DeleteButton } from "./delete-button";
import { EditButton } from "./edit-button";
import { PinButton } from "./pin-button";
import { ToggleVisibilityButton } from "./toggle-visibility-button";

export function CommentDisplayDropdown() {
  const { canModeratePost } = usePostCollectionData();
  const { state } = useCommentDisplay();

  if (!(canModeratePost || state.isAuthor)) {
    return null;
  }

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
      </MenuPopup>
    </Menu>
  );
}
