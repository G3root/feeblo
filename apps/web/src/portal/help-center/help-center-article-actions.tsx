import type { THelpCenterArticlePublic } from "@feeblo/domain/help-center-article/schema";
import { useSite } from "@feeblo/public-feature-board/providers/site-provider";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@feeblo/ui/menu";
import { toastManager } from "@feeblo/ui/toast";
import { cn } from "@feeblo/ui/utils";
import {
  ArrowUpRight01Icon,
  ChatGptIcon,
  ChevronDownIcon,
  ClaudeIcon,
  CodeIcon,
  Copy01Icon,
  Cursor01Icon,
  Download01Icon,
  FileDownloadIcon,
  Link01Icon,
  McpServerIcon,
  MessageMultiple01Icon,
  PrinterIcon,
  SparklesIcon,
  TerminalIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useState,
} from "react";

import {
  helpCenterArticleMarkdownUrl,
  helpCenterMcpServerId,
  renderHelpCenterArticleMarkdown,
} from "@/lib/help-center-agent";
import { m } from "@/paraglide/messages.js";

/**
 * The article's actions, in the shape Blume gives a documentation page: a
 * stack of flat rows that sits under "On this page" on a wide screen and folds
 * into a disclosure on a narrow one.
 *
 * Everything here is client-side except the URL. The Markdown is already in
 * memory, so copy and download never spend a request; the chat and MCP links
 * need the page's own absolute URL, which is read after mount so the server
 * render stays deterministic.
 */

const ACTION_ROW =
  "flex min-h-9 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-start text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2";

const CHAT_PROVIDERS = [
  {
    build: (query: string) =>
      `https://chatgpt.com/?hints=search&prompt=${query}`,
    icon: ChatGptIcon,
    key: "chatgpt",
    name: "ChatGPT",
  },
  {
    build: (query: string) => `https://claude.ai/new?q=${query}`,
    icon: ClaudeIcon,
    key: "claude",
    name: "Claude",
  },
  {
    build: (query: string) => `https://t3.chat/new?q=${query}`,
    icon: MessageMultiple01Icon,
    key: "t3",
    name: "T3 Chat",
  },
  {
    build: (query: string) => `https://scira.ai/?q=${query}`,
    icon: SparklesIcon,
    key: "scira",
    name: "Scira",
  },
  {
    build: (query: string) => `https://cursor.com/link/prompt?text=${query}`,
    icon: Cursor01Icon,
    key: "cursor",
    name: "Cursor",
  },
  {
    build: (query: string) => `https://v0.app?q=${query}`,
    icon: CodeIcon,
    key: "v0",
    name: "v0",
  },
] as const;

type MenuIcon = ComponentProps<typeof HugeiconsIcon>["icon"];

const PROMPT = (markdownUrl: string, title: string) =>
  encodeURIComponent(m.active_salty_termite_stop({ title, url: markdownUrl }));

/** Cursor's documented install deeplink carries a base64 JSON config. */
const cursorInstallUrl = (name: string, url: string) => {
  const config = encodeURIComponent(btoa(JSON.stringify({ url })));

  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${config}`;
};

const vscodeInstallUrl = (name: string, url: string) =>
  `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name, type: "http", url }))}`;

/**
 * The page's own Markdown mirror, read when the action fires.
 *
 * The value is not state: nothing rendered depends on it, and the menus are
 * event handlers, so reading `window.location` at click time avoids an effect
 * and the extra render it would cause.
 */
const currentMarkdownUrl = (slug: string) =>
  helpCenterArticleMarkdownUrl(window.location.origin, slug);

/**
 * The board's MCP endpoint for the page in front of the reader.
 *
 * The dev/dashboard spelling keeps the internal `/s` prefix; a board host
 * does not have one.
 */
const currentMcpUrl = () =>
  `${window.location.origin}${window.location.pathname.startsWith("/s/") ? "/s/mcp" : "/mcp"}`;

async function writeClipboard(value: string) {
  if (navigator.clipboard === undefined) {
    throw new Error("Clipboard unavailable");
  }

  await navigator.clipboard.writeText(value);
}

const notifyCopied = (title: string) => {
  toastManager.add({ title, type: "success" });
};

const notifyCopyFailed = () => {
  toastManager.add({
    description: m.bald_level_koala_charm(),
    title: m.lazy_lucky_puma_dig(),
    type: "error",
  });
};

const copyText = async (value: string, message: string) => {
  try {
    await writeClipboard(value);
    notifyCopied(message);
  } catch {
    notifyCopyFailed();
  }
};

function downloadMarkdown(article: THelpCenterArticlePublic) {
  const markdown = renderHelpCenterArticleMarkdown(
    article,
    window.location.origin
  );

  const blob = new Blob([markdown], {
    type: "text/markdown; charset=utf-8",
  });

  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.download = `${article.slug}.md`;
  link.href = href;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Revoked later: revoking synchronously can cancel the download before the
  // browser has read the blob.
  window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

function openInChat(
  markdownUrl: string,
  title: string,
  build: (query: string) => string
) {
  window.open(
    build(PROMPT(markdownUrl, title)),
    "_blank",
    "noopener,noreferrer"
  );
}

/**
 * Copy-as-Markdown's two-state label.
 *
 * Its own hook because the copied tick has to reset on a timer, and a plain
 * `useState` in the page would keep the timeout after the article unmounts.
 */
function useMarkdownCopy(article: THelpCenterArticlePublic) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => setCopied(false), 2000);

    return () => window.clearTimeout(timeout);
  }, [copied]);

  const copyMarkdown = async () => {
    try {
      await writeClipboard(article.content);
      setCopied(true);
      notifyCopied(m.formal_tame_carp_explore());
    } catch {
      notifyCopyFailed();
    }
  };

  return { copied, copyMarkdown };
}

/**
 * One row that opens a menu.
 *
 * Extracted because the three grouped actions share the trigger, the chevron
 * and the panel width logic, and a row that forgot one of them would look like
 * a different kind of control.
 */
function MenuRow({
  children,
  icon,
  label,
  width = "w-60",
}: {
  readonly children: ReactNode;
  readonly icon: MenuIcon;
  readonly label: string;
  readonly width?: string;
}) {
  return (
    <Menu>
      <MenuTrigger className={cn(ACTION_ROW, "group/menu")}>
        <HugeiconsIcon
          aria-hidden="true"
          className="size-4 shrink-0"
          icon={icon}
        />
        <span className="flex-1">{label}</span>
        <span className="text-muted-foreground flex size-3.5 shrink-0 items-center justify-center transition-transform group-data-[popup-open]/menu:rotate-180">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-3.5"
            icon={ChevronDownIcon}
          />
        </span>
      </MenuTrigger>
      <MenuPopup align="start" className={width} side="bottom">
        {children}
      </MenuPopup>
    </Menu>
  );
}

function CopyRow({
  copied,
  onCopy,
}: {
  readonly copied: boolean;
  readonly onCopy: () => void;
}) {
  return (
    <button className={ACTION_ROW} onClick={onCopy} type="button">
      <HugeiconsIcon
        aria-hidden="true"
        className="size-4 shrink-0"
        icon={copied ? Tick02Icon : Copy01Icon}
      />
      <span className="flex-1">
        {copied ? m.least_sour_badger_quell() : m.less_true_ray_propel()}
      </span>
    </button>
  );
}

function ExportMenu({
  article,
}: {
  readonly article: THelpCenterArticlePublic;
}) {
  return (
    <MenuRow icon={Download01Icon} label={m.good_this_ladybug_quell()}>
      <MenuItem onClick={() => downloadMarkdown(article)}>
        <HugeiconsIcon icon={FileDownloadIcon} />
        {m.deft_drab_gull_win()}
      </MenuItem>
      <MenuItem onClick={() => window.print()}>
        <HugeiconsIcon icon={PrinterIcon} />
        {m.grassy_pretty_blackbird_adore()}
      </MenuItem>
    </MenuRow>
  );
}

function ChatMenu({
  slug,
  title,
}: {
  readonly slug: string;
  readonly title: string;
}) {
  return (
    <MenuRow icon={SparklesIcon} label={m.legal_best_wombat_endure()}>
      {CHAT_PROVIDERS.map((provider) => (
        <MenuItem
          key={provider.key}
          onClick={() =>
            openInChat(currentMarkdownUrl(slug), title, provider.build)
          }
        >
          <HugeiconsIcon icon={provider.icon} />
          {provider.name}
          <HugeiconsIcon
            className="text-muted-foreground ms-auto size-3.5"
            icon={ArrowUpRight01Icon}
          />
        </MenuItem>
      ))}
    </MenuRow>
  );
}

function McpMenu({ mcpName }: { readonly mcpName: string }) {
  const copyCommand = (build: (url: string) => string) => {
    void copyText(build(currentMcpUrl()), m.kind_maroon_chipmunk_strive());
  };

  return (
    <MenuRow
      icon={McpServerIcon}
      label={m.jolly_brave_salmon_relish()}
      width="w-64"
    >
      <MenuItem
        onClick={() => {
          void copyText(currentMcpUrl(), m.tangy_fit_haddock_revive());
        }}
      >
        <HugeiconsIcon icon={Link01Icon} />
        {m.long_moving_dog_fall()}
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        onClick={() =>
          copyCommand(
            (url) => `claude mcp add --transport http ${mcpName} ${url}`
          )
        }
      >
        <HugeiconsIcon icon={ClaudeIcon} />
        {m.least_elegant_raven_achieve()}
      </MenuItem>
      <MenuItem
        onClick={() =>
          copyCommand((url) => `codex mcp add ${mcpName} --url ${url}`)
        }
      >
        <HugeiconsIcon icon={TerminalIcon} />
        {m.gaudy_bright_opossum_succeed()}
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        onClick={() => {
          window.location.assign(cursorInstallUrl(mcpName, currentMcpUrl()));
        }}
      >
        <HugeiconsIcon icon={Cursor01Icon} />
        {m.fun_dry_dolphin_kick()}
        <HugeiconsIcon
          className="text-muted-foreground ms-auto size-3.5"
          icon={ArrowUpRight01Icon}
        />
      </MenuItem>
      <MenuItem
        onClick={() => {
          window.location.assign(vscodeInstallUrl(mcpName, currentMcpUrl()));
        }}
      >
        <HugeiconsIcon icon={CodeIcon} />
        {m.maroon_yummy_pug_bask()}
        <HugeiconsIcon
          className="text-muted-foreground ms-auto size-3.5"
          icon={ArrowUpRight01Icon}
        />
      </MenuItem>
    </MenuRow>
  );
}

export function HelpCenterArticleActions({
  article,
  className,
}: {
  readonly article: THelpCenterArticlePublic;
  readonly className?: string;
}) {
  const site = useSite();
  const { copied, copyMarkdown } = useMarkdownCopy(article);

  return (
    <nav
      aria-label={m.salty_muddy_martin_bump()}
      className={cn("flex flex-col", className)}
    >
      <CopyRow copied={copied} onCopy={() => void copyMarkdown()} />
      <ExportMenu article={article} />
      <ChatMenu slug={article.slug} title={article.title} />
      <McpMenu mcpName={helpCenterMcpServerId(site)} />
    </nav>
  );
}

/**
 * The same actions, folded under the outline on the screens with no rail.
 *
 * A separate `<details>` rather than a copy of the outline's: an article with
 * no headings still has actions, so the page renders this when there is no
 * outline to carry them.
 */
export function HelpCenterArticleActionsDisclosure({
  article,
  className,
}: {
  readonly article: THelpCenterArticlePublic;
  readonly className?: string;
}) {
  return (
    <details
      className={cn(
        "group border-border/70 rounded-xl border xl:hidden",
        className
      )}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {m.salty_muddy_martin_bump()}
        <span className="text-muted-foreground flex size-4 items-center justify-center transition-transform group-open:rotate-180">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-4"
            icon={ChevronDownIcon}
          />
        </span>
      </summary>
      <div className="border-border/70 border-t p-2">
        <HelpCenterArticleActions article={article} />
      </div>
    </details>
  );
}
