import { AutocompleteItem } from "prosekit/react/autocomplete";

export default function SlashMenuItem(props: {
  label: string;
  kbd?: string;
  onSelect: () => void;
}) {
  return (
    <AutocompleteItem
      className="data-highlighted:bg-accent data-highlighted:text-accent-foreground relative box-border flex min-w-32 cursor-default scroll-my-1 items-center justify-between rounded-md px-3 py-1.5 text-sm whitespace-nowrap outline-hidden select-none"
      onSelect={props.onSelect}
    >
      <span>{props.label}</span>
      {props.kbd && (
        <kbd className="text-muted-foreground font-mono text-xs">
          {props.kbd}
        </kbd>
      )}
    </AutocompleteItem>
  );
}
