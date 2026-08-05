import { useNavigate } from "@solidjs/router";
import type { WidgetUpdate } from "../../lib/api";
import { Button } from "../ui/button";
import { MarkdownContent } from "../ui/markdown-content";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function UpdateDetail(props: { update: WidgetUpdate }) {
  const navigate = useNavigate();

  return (
    <article class="p-6">
      <Button onClick={() => navigate("/updates")} size="sm" variant="outline">
        <span aria-hidden="true">←</span>
        All updates
      </Button>
      <header class="mt-8 pr-10">
        <time class="font-medium text-[11px] text-muted-foreground uppercase tracking-[0.12em]">
          {dateFormatter.format(new Date(props.update.publishedAt))}
        </time>
        <h1 class="mt-2 font-semibold text-2xl leading-tight tracking-tight">
          {props.update.title}
        </h1>
      </header>
      <MarkdownContent class="mt-6" content={props.update.content} />
    </article>
  );
}
