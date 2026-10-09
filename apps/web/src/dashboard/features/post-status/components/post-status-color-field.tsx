import { DEFAULT_POST_STATUS_COLORS } from "@feeblo/domain-contracts/post-status-colors";
import { cn } from "@feeblo/ui/utils";

const SWATCHES: readonly string[] = Object.values(DEFAULT_POST_STATUS_COLORS);

/**
 * A palette rather than a colour input.
 *
 * Status colours are stored as `oklch()` strings, which a native colour input
 * cannot express without a lossy round trip through sRGB. The six seeded
 * colours are the palette a workspace already sees on its board, and a status
 * carrying a colour from outside it — one set before this page existed — is
 * offered alongside them instead of being silently replaced.
 */
export function PostStatusColorField({
  onChange,
  value,
}: {
  onChange: (color: string) => void;
  value: string | null;
}) {
  const options =
    value && !SWATCHES.includes(value) ? [...SWATCHES, value] : SWATCHES;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((color) => (
        <button
          aria-label={`Use colour ${color}`}
          aria-pressed={color === value}
          className={cn(
            "focus-visible:ring-ring focus-visible:ring-offset-background size-6 rounded-full ring-offset-2 transition-shadow focus-visible:ring-2 focus-visible:outline-none",
            color === value && "ring-ring ring-2"
          )}
          key={color}
          onClick={() => onChange(color)}
          style={{ backgroundColor: color }}
          type="button"
        />
      ))}
    </div>
  );
}
