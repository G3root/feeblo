import { A } from "@solidjs/router";
import { Show } from "solid-js";

import type { WidgetUpdate } from "../../lib/api";
import { Card } from "../ui/card";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function UpdateCard(props: { update: WidgetUpdate }) {
  return (
    <Card
      class="group hover:border-foreground/20 focus-visible:ring-ring/30 overflow-hidden rounded-xl transition-[border-color,box-shadow,transform] duration-150 before:rounded-[calc(var(--radius-xl)-1px)] hover:shadow-sm focus-visible:ring-[3px] active:scale-[0.985] motion-reduce:active:scale-100"
      href={`/updates/${props.update.id}`}
      render={A}
    >
      <Show when={props.update.imageUrl}>
        {(imageUrl) => (
          <img
            alt=""
            class="h-32 w-full border-b object-cover"
            height="128"
            loading="lazy"
            src={imageUrl()}
            width="352"
          />
        )}
      </Show>
      <article class="flex flex-col gap-1 p-4">
        <time class="text-muted-foreground text-[11px] font-medium tracking-[0.12em] uppercase">
          {dateFormatter.format(props.update.publishedAt)}
        </time>
        <h2 class="text-base leading-snug font-semibold tracking-tight">
          {props.update.title}
        </h2>
        <Show when={props.update.excerpt}>
          <p class="text-muted-foreground line-clamp-2 text-sm">
            {props.update.excerpt}
          </p>
        </Show>
      </article>
    </Card>
  );
}
