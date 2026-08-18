import { AutocompleteEmpty } from "prosekit/react/autocomplete";

export default function SlashMenuEmpty() {
  return (
    <AutocompleteEmpty className="data-highlighted:bg-accent data-highlighted:text-accent-foreground relative box-border flex min-w-32 cursor-default scroll-my-1 items-center justify-between rounded-md px-3 py-1.5 text-sm whitespace-nowrap outline-hidden select-none">
      <span>No results</span>
    </AutocompleteEmpty>
  );
}
