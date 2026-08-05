export function PoweredByBadge() {
  return (
    <div class="mt-3 flex items-center justify-center px-2 py-1">
      <a
        class="rounded-lg border border-transparent px-1.5 py-0.5 font-medium text-muted-foreground text-xs transition-colors hover:border-border hover:bg-muted dark:hover:bg-white/5"
        draggable={false}
        href="https://feeblo.com?utm_source=powered_by&utm_medium=referral&utm_campaign=widget"
        rel="noopener noreferrer"
        target="_blank"
      >
        Powered by{" "}
        <span class="animate-gradient bg-[length:200%_auto] bg-gradient-to-r from-primary/60 via-primary to-primary/60 bg-clip-text font-semibold text-transparent">
          Feeblo
        </span>
      </a>
    </div>
  );
}
