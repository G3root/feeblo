export function PoweredByBadge() {
  return (
    <div class="bg-popover flex shrink-0 items-center justify-center px-3 py-2">
      <a
        class="text-muted-foreground hover:border-border hover:bg-muted rounded-lg border border-transparent px-1.5 py-0.5 text-xs font-medium transition-colors dark:hover:bg-white/5"
        draggable={false}
        href="https://feeblo.com?utm_source=powered_by&utm_medium=referral&utm_campaign=widget"
        rel="noopener noreferrer"
        target="_blank"
      >
        Powered by{" "}
        <span class="from-primary/60 via-primary to-primary/60 bg-gradient-to-r bg-clip-text font-semibold text-transparent">
          Feeblo
        </span>
      </a>
    </div>
  );
}
