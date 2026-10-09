import type { WidgetUpdate } from "../../lib/api";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * A single published update. The shell owns the back control now, so this is
 * only the article: date, title, and the rendered content.
 */
export function UpdateDetail(props: { update: WidgetUpdate }) {
  return (
    <article class="typeset typeset-sm p-6">
      <header class="mb-6">
        <time>{dateFormatter.format(props.update.publishedAt)}</time>
        <h1 class="mt-2">{props.update.title}</h1>
      </header>
      <div innerHTML={props.update.content} />
    </article>
  );
}

export function UpdateNotFound() {
  return (
    <div class="flex min-h-full items-center justify-center p-6">
      <Empty class="max-w-sm border p-8">
        <EmptyHeader>
          <EmptyTitle>Update not found</EmptyTitle>
          <EmptyDescription>
            This update may have been unpublished or the link is out of date.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
