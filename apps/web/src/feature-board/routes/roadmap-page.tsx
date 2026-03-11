import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

const ROADMAP_ITEMS = [
  {
    notes: "Expose board cards for external widgets and status mirrors.",
    quarter: "Q2",
    title: "Public API for board embeds",
  },
  {
    notes: "Group posts into milestone timelines and release trains.",
    quarter: "Q3",
    title: "Roadmap milestones",
  },
  {
    notes: "Configure one-vote and weighted-vote modes for organizations.",
    quarter: "Q4",
    title: "Feedback voting rules",
  },
] as const;

export function RoadmapPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-3">
        <Badge variant="outline">Roadmap preview</Badge>
        <h1 className="font-semibold text-3xl tracking-tight">What is next</h1>
        <p className="max-w-2xl text-muted-foreground text-sm leading-6">
          Planned public-facing improvements and milestones for the feedback
          experience.
        </p>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {ROADMAP_ITEMS.map((item) => (
          <Card className="ring-1 ring-border/60" key={item.title}>
            <CardHeader className="space-y-3">
              <Badge variant="outline">{item.quarter}</Badge>
              <CardTitle>{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm leading-6">
              {item.notes}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
