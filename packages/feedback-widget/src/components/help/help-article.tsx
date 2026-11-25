import type { WidgetHelpCenterArticleDetail } from "../../lib/api";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * One published article. The shell owns the back control, so this is only the
 * page: section, title, updated date and the rendered body.
 *
 * The body arrives as HTML because the server renders the stored Markdown
 * through the same cached pipeline the updates module uses — the widget has one
 * renderer fewer to keep correct.
 */
export function HelpArticle(props: { article: WidgetHelpCenterArticleDetail }) {
  return (
    <article class="typeset typeset-sm p-6">
      <header class="mb-6">
        <p class="text-muted-foreground text-xs">{props.article.topicName}</p>
        <h1 class="mt-2">{props.article.title}</h1>
        <p class="text-muted-foreground mt-2 text-xs">
          Updated {dateFormatter.format(props.article.updatedAt)}
        </p>
      </header>
      <div innerHTML={props.article.content} />
    </article>
  );
}

export function HelpArticleNotFound() {
  return (
    <div class="flex min-h-full items-center justify-center p-6">
      <Empty class="max-w-sm border p-8">
        <EmptyHeader>
          <EmptyTitle>Article not found</EmptyTitle>
          <EmptyDescription>
            It may have been unpublished, or the link is out of date.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
