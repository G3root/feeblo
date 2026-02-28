<script lang="ts">
  export interface PostPreviewCardProps {
    readonly slug: string;
    readonly status: "Planned" | "In Progress" | "Complete";
    readonly summary: string;
    readonly title: string;
  }

  let { slug, status, summary, title }: PostPreviewCardProps = $props();
</script>

<article class="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
  <p class="text-xs text-zinc-500 uppercase tracking-wide">{status}</p>
  <h2 class="mt-2 font-medium text-xl text-zinc-900">{title}</h2>
  <p class="mt-2 text-sm text-zinc-600">{summary}</p>
  <a
    class="mt-4 inline-flex font-medium text-sm text-zinc-900 underline"
    href={`/p/${slug}`}
  >
    Open post
  </a>
</article>
