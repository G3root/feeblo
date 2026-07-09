import { AutocompleteEmpty } from "prosekit/react/autocomplete";

export default function SlashMenuEmpty() {
  return (
    <AutocompleteEmpty className="relative box-border flex min-w-32 cursor-default select-none scroll-my-1 items-center justify-between whitespace-nowrap rounded-md px-3 py-1.5 text-sm outline-hidden data-highlighted:bg-accent data-highlighted:text-accent-foreground">
      <span>No results</span>
    </AutocompleteEmpty>
  );
}
