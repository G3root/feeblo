import * as Effect from "effect/Effect";
import React, { type ReactNode } from "react";
import { render } from "takumi-js";

import type { TPostStatus } from "../post-status/schema";
import { OgImageRenderError } from "./errors";
import type { OgImageData } from "./schema";

const IMAGE_SIZE = { height: 630, width: 1200 } as const;

const statusPresentation: Record<
  TPostStatus["type"],
  { color: string; label: string }
> = {
  CLOSED: { color: "#a1a1aa", label: "Closed" },
  COMPLETED: { color: "#34d399", label: "Completed" },
  IN_PROGRESS: { color: "#fbbf24", label: "In Progress" },
  PENDING: { color: "#a78bfa", label: "Pending" },
  PLANNED: { color: "#818cf8", label: "Planned" },
  REVIEW: { color: "#38bdf8", label: "In Review" },
};

interface OgFrameProps {
  children: ReactNode;
  siteName: string;
}

function BrandMark() {
  return (
    <div tw="flex h-11 w-11 items-center justify-center rounded-full bg-slate-700 text-2xl text-white">
      +
    </div>
  );
}

function OgFrame({ children, siteName }: OgFrameProps) {
  return (
    <div tw="flex h-full w-full bg-linear-to-br from-zinc-900 font-sans text-zinc-100 overflow-hidden">
      <div tw="absolute -top-24 -right-24 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl " />
      <div tw="relative flex h-full w-full flex-col px-[76px] py-[76px]">
        <div tw="flex items-center gap-3">
          <BrandMark />
          <div tw="text-[34px] font-bold leading-none">{siteName}</div>
        </div>

        <div tw="mt-auto flex flex-col pb-[38px]">{children}</div>
        <div tw="absolute bottom-0 left-0 h-4 w-full bg-[#6558b5]" />
      </div>
    </div>
  );
}

interface MainImageProps {
  accentLabel?: string;
  description: string;
  siteName: string;
  title: string;
}

function MainImage({
  accentLabel,
  description,
  siteName,
  title,
}: MainImageProps) {
  return (
    <OgFrame siteName={siteName}>
      {accentLabel ? (
        <div tw="mb-7 text-[28px] font-medium text-[#8b7cff]">
          {accentLabel}
        </div>
      ) : null}
      <div tw="text-[48px] font-bold leading-tight tracking-[-1px]">
        {title}
      </div>
      <div tw="mt-4 max-w-[990px] text-[32px] leading-[1.35] text-[#b7bdd1]">
        {description}
      </div>
    </OgFrame>
  );
}

interface MetaItemProps {
  icon: ReactNode;
  label: string;
}

function MetaItem({ icon, label }: MetaItemProps) {
  return (
    <div tw="flex items-center gap-3 text-[30px] text-[#b7bdd1]">
      <div tw="flex h-7 w-7 items-center justify-center text-[#aeb5c7]">
        {icon}
      </div>
      {label}
    </div>
  );
}

function BoardIcon() {
  return (
    <svg aria-hidden="true" height="28" viewBox="0 0 24 24" width="28">
      <path
        d="M4 7h16l2 4v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7l2-4Zm2-4h12v2H6V3Zm-2 9v6h16v-6h-4l-2 2h-4l-2-2H4Z"
        fill="#aeb5c7"
      />
    </svg>
  );
}

function UpvoteIcon() {
  return (
    <svg aria-hidden="true" height="28" viewBox="0 0 24 24" width="28">
      <path
        d="M2 20h4V9H2v11Zm20-10a2 2 0 0 0-2-2h-6.31l.95-4.57.03-.32a1.5 1.5 0 0 0-.44-1.06L13.17 1 6.59 7.59A2 2 0 0 0 6 9v9a2 2 0 0 0 2 2h9a2 2 0 0 0 1.84-1.21l3.02-7.05c.09-.23.14-.47.14-.74v-1Z"
        fill="#aeb5c7"
      />
    </svg>
  );
}

export function OgImage(props: OgImageData) {
  switch (props.type) {
    case "feedback-main":
      return (
        <MainImage
          accentLabel="Feedback"
          description={`Tell ${props.siteName} how they could make the product more useful to you.`}
          siteName={props.siteName}
          title="Have something to say?"
        />
      );
    case "changelog-main":
      return (
        <MainImage
          description="Keep up with the latest improvements, fixes, and product updates."
          siteName={props.siteName}
          title="Changelog"
        />
      );
    case "roadmap-main":
      return (
        <MainImage
          description="See what's coming next and vote for your favorite ideas."
          siteName={props.siteName}
          title="Roadmap"
        />
      );
    case "post-detail": {
      const status = statusPresentation[props.status];
      const upvoteLabel = `${props.upvoteCount} ${props.upvoteCount === 1 ? "Upvote" : "Upvotes"}`;

      return (
        <OgFrame siteName={props.siteName}>
          <div
            style={{ color: status.color }}
            tw="mb-8 text-[28px] font-medium"
          >
            {status.label}
          </div>
          <div tw="max-w-[1040px] text-[48px] font-bold leading-tight tracking-[-1px]">
            {props.title}
          </div>
          <div tw="mt-9 flex items-center gap-12">
            <MetaItem icon={<BoardIcon />} label={props.boardName} />
            <MetaItem icon={<UpvoteIcon />} label={upvoteLabel} />
          </div>
        </OgFrame>
      );
    }
    default:
      return null;
  }
}

export const generateOgImage = Effect.fn("generateOgImage")(function* (
  props: OgImageData
) {
  return yield* Effect.tryPromise({
    try: () => render(React.createElement(OgImage, props), IMAGE_SIZE),
    catch: (cause) => new OgImageRenderError({ cause }),
  });
});
