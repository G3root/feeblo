import { TablerIcon } from "../ui/tabler-icon";
import { useFeedbackForm } from "./context";

export function FeedbackFormHeader() {
  const { meta } = useFeedbackForm();

  return (
    <header class="px-6 pt-1">
      <h1 class="text-foreground flex items-center gap-2 text-lg font-medium first-letter:uppercase">
        <TablerIcon
          class="text-muted-foreground size-5"
          name={meta.board.icon ?? "layout-grid"}
        />
        {meta.board.name}
      </h1>
      <p class="text-muted-foreground mt-1 text-sm">
        Tell us what you need. We read every post.
      </p>
    </header>
  );
}
