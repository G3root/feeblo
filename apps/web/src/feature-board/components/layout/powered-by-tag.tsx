import { Badge } from "~/components/ui/badge";

export function PoweredByTag() {
  return (
    <a
      className="fixed right-4 bottom-4 z-50 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      href="https://feeblo.com"
      rel="noreferrer"
      target="_blank"
    >
      <Badge className="h-7 gap-1 rounded-full border-border/70 bg-background/90 px-3 text-foreground text-xs shadow-black/10 shadow-lg backdrop-blur-md">
        <span className="text-muted-foreground">Powered by</span>
        <span className="font-semibold tracking-tight">feeblo</span>
      </Badge>
    </a>
  );
}
