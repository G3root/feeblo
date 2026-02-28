<script lang="ts">
interface Option {
  label: string;
  value: string;
}

interface BoardSelectProps {
  onSelectedBoardIdChange: (board: Option | null) => void;
  options: Option[];
  selectedBoardId: Option | null;
}

let { onSelectedBoardIdChange, options, selectedBoardId }: BoardSelectProps = $props();

const selectedValue = $derived(selectedBoardId?.value ?? "all");

function handleChange(event: Event) {
  const nextValue = (event.currentTarget as HTMLSelectElement).value;
  const nextOption = options.find((option) => option.value === nextValue) ?? null;
  onSelectedBoardIdChange(nextOption);
}
</script>

<select
  class="h-9 min-w-48 rounded-md border border-input bg-background px-3 text-sm shadow-xs"
  on:change={handleChange}
  value={selectedValue}
>
  {#each options as option}
    <option value={option.value}>{option.label}</option>
  {/each}
</select>
