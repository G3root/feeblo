import { MenuItem } from "@feeblo/ui/menu";

import { useCommentDisplay } from "./context";

export function PinButton() {
  const { actions, meta, state } = useCommentDisplay();

  return (
    <MenuItem onClick={actions.onTogglePin}>
      <PinIcon />
      {state.pinnedAt != null ? meta.unpinLabel : meta.pinLabel}
    </MenuItem>
  );
}

function PinIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
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
