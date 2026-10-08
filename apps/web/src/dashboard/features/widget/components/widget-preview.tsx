import { Badge } from "@feeblo/ui/badge";
import { Card } from "@feeblo/ui/card";
import { Skeleton } from "@feeblo/ui/skeleton";
import { cn } from "@feeblo/ui/utils";
import { isObject, isString } from "@feeblo/utils/runtime-kind";
import { LockIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSelector } from "@xstate/store-react";
import { useEffect, useRef, useState, type Ref } from "react";

import {
  WIDGET_MODE_LABELS,
  widgetEmbedConfig,
  type WidgetEmbedConfig,
} from "../lib/widget-config";
import { useWidgetStore } from "../lib/widget-store";

/**
 * The launcher glyph the SDK draws, so the preview mirrors the real widget
 * rather than approximating it.
 */
function LauncherGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M5 5.75h14v9.5H9.25L5 18.75v-13Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
      <path
        d="M8.5 9h7M8.5 12h4.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.75"
      />
    </svg>
  );
}

interface WidgetPreviewProps {
  organizationId: string;
}

/**
 * Live preview of the embedded widget: the real iframe document the SDK
 * frames, on a stand-in page. Only the host page and the launcher are drawn
 * here — the panel itself is the shipped widget.
 */
export function WidgetPreview({ organizationId }: WidgetPreviewProps) {
  const store = useWidgetStore();
  const draft = useSelector(store, (snapshot) => snapshot.context.draft);
  const config = widgetEmbedConfig(draft);
  const [isOpen, setIsOpen] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const onRight = config.placement !== "bottom-left";
  // Changing any of these remounts the iframe, because the widget reads its
  // configuration once when it boots.
  const configKey = `${config.mode}:${config.modules.join(",")}:${config.theme}`;
  const iframeSrc = widgetPreviewUrl(organizationId, config);

  useEffect(() => {
    // The remounted widget boots open on its own, so the overlay follows it.
    setIsOpen(true);
  }, [configKey]);

  // The widget's own close button posts CLOSE to the host page. Mirror it so
  // the preview's trigger can reopen the panel instead of it reappearing.
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const data: unknown = event.data;
      if (!(isObject(data) && "event" in data) || !isString(data.event)) {
        return;
      }
      if (data.event === "CLOSE") {
        setIsOpen(false);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // The panel is only an overlay; the widget keeps its own open state, so a
  // reopening has to reach it the same way the SDK's `open`/`close` do.
  const setOpen = (next: boolean) => {
    setIsOpen(next);
    iframeRef.current?.contentWindow?.postMessage(
      { event: next ? "SHOW" : "HIDE" },
      window.location.origin
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-medium">Preview</h2>
          <p className="text-muted-foreground text-xs">
            Reflects the settings on the left.
          </p>
        </div>
        <Badge variant="outline">{WIDGET_MODE_LABELS[config.mode]}</Badge>
      </div>
      <Card className="overflow-hidden p-0">
        <div className="bg-muted/40 flex items-center gap-2 border-b px-3 py-2">
          <span aria-hidden="true" className="flex items-center gap-1.5">
            <span className="bg-foreground/15 size-2.5 rounded-full" />
            <span className="bg-foreground/15 size-2.5 rounded-full" />
            <span className="bg-foreground/15 size-2.5 rounded-full" />
          </span>
          <span className="bg-background text-muted-foreground mx-auto flex max-w-[60%] items-center gap-1.5 truncate rounded-md px-2.5 py-1 text-[11px] shadow-xs/5">
            <HugeiconsIcon className="size-3 shrink-0" icon={LockIcon} />
            your-site.com
          </span>
          <span aria-hidden="true" className="w-10" />
        </div>
        {/* Taller than the panel on purpose: the strip above it is the host
            page the widget is floating over. Both heights track the viewport
            so the sticky column still fits a short laptop screen. */}
        <div className="bg-background relative h-[clamp(440px,calc(100dvh-19rem),560px)] overflow-hidden">
          <FakePage />
          <div
            aria-hidden={!isOpen}
            className={cn(
              "bg-background absolute bottom-20 z-20 h-[min(400px,calc(100%-6.5rem))] w-[400px] max-w-[calc(100%-2.5rem)] overflow-hidden rounded-2xl shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_2px_4px_rgba(0,0,0,0.06),0_12px_24px_rgba(0,0,0,0.08),0_24px_48px_rgba(0,0,0,0.12)] transition-[opacity,visibility] duration-150 ease-out",
              onRight ? "right-5" : "left-5",
              isOpen ? "opacity-100" : "pointer-events-none invisible opacity-0"
            )}
          >
            <WidgetFrame key={configKey} ref={iframeRef} src={iframeSrc} />
          </div>
          {config.placement === undefined ? (
            <button
              aria-expanded={isOpen}
              aria-label="Open the widget preview"
              className="absolute right-5 bottom-5 z-20 flex h-8 items-center gap-1.5 rounded-full border border-dashed px-3 text-xs font-medium transition-transform duration-150 ease-out active:scale-[0.97]"
              onClick={() => setOpen(true)}
              type="button"
            >
              <LauncherGlyph className="size-3.5" />
              Preview trigger
            </button>
          ) : (
            <button
              aria-expanded={isOpen}
              aria-label={
                isOpen ? "Close the widget preview" : "Open the widget preview"
              }
              className={cn(
                "focus-visible:ring-ring absolute bottom-5 z-20 flex size-11 items-center justify-center rounded-full border border-white/12 bg-[#171717] text-white shadow-[0_8px_28px_rgba(0,0,0,0.22)] transition-transform duration-150 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.97]",
                onRight ? "right-5" : "left-5"
              )}
              onClick={() => setOpen(!isOpen)}
              type="button"
            >
              <LauncherGlyph className="size-[18px]" />
            </button>
          )}
        </div>
      </Card>
      <p className="text-muted-foreground text-xs">
        {config.placement === undefined
          ? "No launcher is embedded. Open the widget with Feeblo.open() from your own button."
          : "The mock page is decoration; the widget in the corner is the real embed."}
      </p>
    </div>
  );
}

interface WidgetFrameProps {
  ref?: Ref<HTMLIFrameElement>;
  src: string;
}

/**
 * The iframe plus its first-load cover. Mounted under a `configKey` key so a
 * config change starts from a fresh `isLoaded` — resetting it from an effect
 * races the iframe's own `load` event, which can leave the cover up forever.
 */
function WidgetFrame({ ref, src }: WidgetFrameProps) {
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <>
      {isLoaded ? null : (
        <Skeleton className="absolute inset-0 z-10 rounded-none" />
      )}
      <iframe
        allow="clipboard-write"
        className="size-full border-0"
        onLoad={() => setIsLoaded(true)}
        ref={ref}
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-downloads"
        src={src}
        title="Widget preview"
      />
    </>
  );
}

/** The banner and page furniture behind the widget, in the host page's place. */
function FakePage() {
  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <div className="bg-foreground/10 size-7 rounded-lg" />
        <div className="bg-foreground/6 h-2 w-16 rounded-full" />
        <div className="bg-foreground/6 h-2 w-10 rounded-full" />
        <div className="bg-foreground/10 ml-auto h-7 w-20 rounded-lg" />
      </div>
      <div className="flex flex-col gap-2.5">
        <div className="bg-foreground/10 h-5 w-2/3 rounded-md" />
        <div className="bg-foreground/6 h-3 w-1/2 rounded-full" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-foreground/4 h-24 rounded-xl border" />
        <div className="bg-foreground/4 h-24 rounded-xl border" />
        <div className="bg-foreground/4 h-24 rounded-xl border" />
      </div>
    </div>
  );
}

/**
 * The iframe document the SDK points at, with the current settings in the
 * query string. `hostOrigin` mirrors `createIframe` so the widget can post
 * its close message back to this page.
 */
function widgetPreviewUrl(
  organizationId: string,
  config: WidgetEmbedConfig
): string {
  const params = new URLSearchParams();
  params.set("mode", config.mode);
  if (config.mode === "hub") {
    params.set("modules", config.modules.join(","));
  }
  params.set("theme", config.theme);
  params.set("hostOrigin", window.location.origin);
  const hash = config.modules[0] === "updates" ? "#/updates" : "#/";
  return `/feedback-widget/${organizationId}?${params.toString()}${hash}`;
}
