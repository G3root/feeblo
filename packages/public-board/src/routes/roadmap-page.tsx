const ROADMAP_ITEMS = [
  {
    quarter: "Q2",
    title: "Public API For Board Embeds",
    notes: "Expose board cards for external widgets and status mirrors.",
  },
  {
    quarter: "Q3",
    title: "Roadmap Milestones",
    notes: "Group posts into milestone timelines and release trains.",
  },
  {
    quarter: "Q4",
    title: "Feedback Voting Rules",
    notes: "Configure one-vote and weighted-vote modes for organizations.",
  },
] as const;

export function RoadmapPage() {
  return (
    <section class="space-y-3">
      {ROADMAP_ITEMS.map((item) => (
        <article class="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <p class="text-xs text-zinc-500 uppercase tracking-wide">
            {item.quarter}
          </p>
          <h2 class="mt-1 font-medium text-lg text-zinc-900">{item.title}</h2>
          <p class="mt-2 text-sm text-zinc-600">{item.notes}</p>
        </article>
      ))}
    </section>
  );
}
