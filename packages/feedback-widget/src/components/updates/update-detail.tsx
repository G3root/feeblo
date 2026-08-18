import { useNavigate } from "@solidjs/router";

import type { WidgetUpdate } from "../../lib/api";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function UpdateDetail(props: { update: WidgetUpdate }) {
  const navigate = useNavigate();

  return (
    <article class="typeset typeset-sm p-6">
      <Button onClick={() => navigate("/updates")} size="sm" variant="outline">
        <Icon name="ArrowLeft01Icon" />
        All updates
      </Button>
      <header class="mt-8 pr-10">
        <time>{dateFormatter.format(new Date(props.update.publishedAt))}</time>
        <h1 class="mt-2">{props.update.title}</h1>
      </header>
      <div class="mt-6" innerHTML={props.update.content} />
    </article>
  );
}
