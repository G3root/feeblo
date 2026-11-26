import { onMount, Show } from "solid-js";

import type { WidgetHelpCenterArticleDetail } from "../../lib/api";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";

/** The portal's own article links, which the widget serves at `#/help/:slug`. */
const ARTICLE_LINK_PREFIX = "/help/articles/";

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
  let body: HTMLDivElement | undefined;

  onMount(() => {
    if (body !== undefined) {
      rewriteLinks(body);
    }
  });

  return (
    <article class="typeset typeset-sm p-6">
      <header class="mb-6">
        <p class="text-muted-foreground text-xs">{props.article.topicName}</p>
        <h1 class="mt-2">{props.article.title}</h1>
        <p class="text-muted-foreground mt-2 text-xs">
          Updated {dateFormatter.format(props.article.updatedAt)}
        </p>
        <Show when={props.article.isArchived}>
          <p class="text-muted-foreground mt-3 rounded-md border px-3 py-2 text-xs">
            This article describes behaviour that is no longer current.
          </p>
        </Show>
      </header>
      <div innerHTML={props.article.content} ref={body} />
    </article>
  );
}

/**
 * Point the body's links at the widget, not at the host.
 *
 * The article was written for the portal, where another article is a path
 * (`/help/articles/set-up-your-workspace`). Inside the iframe that path
 * resolves against the *app* origin and replaces the widget document with a
 * missing page. Internal article links become the widget's own hash routes;
 * everything else — the portal's other pages, external documentation — is not
 * this iframe's to render, so it opens outside it.
 */
function rewriteLinks(container: HTMLElement) {
  for (const anchor of container.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";

    if (href.startsWith(ARTICLE_LINK_PREFIX)) {
      anchor.setAttribute(
        "href",
        `#/help/${href.slice(ARTICLE_LINK_PREFIX.length)}`
      );

      continue;
    }

    // The author's own in-page anchors stay in the document; the body carries no
    // heading ids today, so this is a pass-through rather than a rewrite.
    if (href.startsWith("#")) {
      continue;
    }

    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noreferrer noopener");
  }
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
