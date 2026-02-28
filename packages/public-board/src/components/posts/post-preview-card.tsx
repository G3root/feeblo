import { A } from "@solidjs/router";

export interface PostPreviewCardProps {
  readonly slug: string;
  readonly status: "Planned" | "In Progress" | "Complete";
  readonly summary: string;
  readonly title: string;
}

export function PostPreviewCard(props: PostPreviewCardProps) {
  return (
    <article class="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p class="text-xs text-zinc-500 uppercase tracking-wide">
        {props.status}
      </p>
      <h2 class="mt-2 font-medium text-xl text-zinc-900">{props.title}</h2>
      <p class="mt-2 text-sm text-zinc-600">{props.summary}</p>
      <A
        class="mt-4 inline-flex font-medium text-sm text-zinc-900 underline"
        href={`/p/${props.slug}`}
      >
        Open post
      </A>
    </article>
  );
}
