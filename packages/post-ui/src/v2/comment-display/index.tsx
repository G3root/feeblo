import { CommentDisplayActions } from "./actions";
import { CommentDisplayAvatar } from "./avatar";
import { CommentDisplayBody } from "./body";
import { CommentDisplayComponent } from "./component";
import { CommentDisplayDropdown } from "./dropdown";
import { CommentDisplayHeader } from "./header";
import { CommentDisplayProvider } from "./provider";

export { CommentsList } from "./list";
export { CommentDisplayProvider };

export const CommentDisplay = Object.assign(CommentDisplayComponent, {
  Actions: CommentDisplayActions,
  Avatar: CommentDisplayAvatar,
  Body: CommentDisplayBody,
  Dropdown: CommentDisplayDropdown,
  Header: CommentDisplayHeader,
  Provider: CommentDisplayProvider,
});