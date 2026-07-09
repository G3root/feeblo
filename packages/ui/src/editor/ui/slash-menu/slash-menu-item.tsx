import { AutocompleteItem } from "prosekit/react/autocomplete";

export default function SlashMenuItem(props: {
  label: string;
  kbd?: string;
  onSelect: () => void;
}) {
  return (
    <AutocompleteItem
      className="relative box-border flex min-w-32 cursor-default select-none scroll-my-1 items-center justify-between whitespace-nowrap rounded-md px-3 py-1.5 text-sm outline-hidden data-highlighted:bg-accent data-highlighted:text-accent-foreground"
      onSelect={props.onSelect}
    >
      <span>{props.label}</span>
      {props.kbd && (
        <kbd className="font-mono text-muted-foreground text-xs">
          {props.kbd}
        </kbd>
      )}
    </AutocompleteItem>
  );
}
