import * as React from "react";
import { Img, Section, Text } from "react-email";

import { EmailShell } from "./email-shell";

export type ChangelogEmailProps = {
  /** Label for the primary call-to-action button, e.g. "View changelog". */
  readonly actionLabel: string;
  /** URL the CTA points to (typically the public changelog entry). */
  readonly actionUrl: string;
  /** Short description / excerpt rendered as the lead under the title. */
  readonly body: string;
  /** Small eyebrow label rendered in the preview, e.g. "Changelog". */
  readonly eyebrow: string;
  /** Main heading — the changelog entry title. */
  readonly title: string;
  /** One-click unsubscribe URL (derived bearer token). */
  readonly unsubscribeUrl: string;
  /** Optional cover image URL rendered as a full-width header image. */
  readonly coverImageUrl?: string | null | undefined;
  /** Optional category names rendered as a dot-separated list. */
  readonly categories?: readonly string[] | undefined;
  /** Optional workspace / organization display name shown in meta line. */
  readonly organizationName?: string | null | undefined;
  /** Optional human-readable publish date, e.g. "April 12, 2026". */
  readonly publishedAtLabel?: string | null | undefined;
};

export const ChangelogEmail = ({
  actionLabel,
  actionUrl,
  body,
  eyebrow,
  title,
  unsubscribeUrl,
  coverImageUrl,
  categories,
  organizationName,
  publishedAtLabel,
}: ChangelogEmailProps) => (
  <EmailShell
    cta={{ label: actionLabel, href: actionUrl }}
    footerBlurb="You received this because you subscribed to changelog updates for this workspace. You can manage all email notifications from your workspace settings."
    homeUrl="https://feeblo.com"
    preview={`${eyebrow}: ${title}`}
    title={title}
    titleLead={body}
    unsubscribeUrl={unsubscribeUrl}
  >
    {coverImageUrl ? (
      <Section className="border-stroke overflow-hidden rounded-[8px] border">
        <Img
          alt={title}
          className="block w-full object-cover"
          src={coverImageUrl}
          style={{ maxHeight: "320px" }}
        />
      </Section>
    ) : null}

    {categories && categories.length > 0 ? (
      <Section className={coverImageUrl ? "mt-6" : undefined}>
        <Text className="font-11 text-fg-3 m-0 font-sans tracking-[0.06em] uppercase">
          {categories.length === 1 ? "Category" : "Categories"}
        </Text>
        <Text className="font-13 text-fg-2 m-0 mt-2 font-sans">
          {categories.join("  ·  ")}
        </Text>
      </Section>
    ) : null}

    {organizationName || publishedAtLabel ? (
      <Section
        className={`border-stroke border-t pt-6 ${coverImageUrl || (categories && categories.length > 0) ? "mt-6" : ""}`}
      >
        <Text className="font-13 text-fg-3 m-0 font-sans">
          {[organizationName, publishedAtLabel].filter(Boolean).join("  ·  ")}
        </Text>
      </Section>
    ) : null}
  </EmailShell>
);

export const createChangelogEmail = (props: ChangelogEmailProps) => ({
  subject: props.title,
  react: React.createElement(ChangelogEmail, props),
});

ChangelogEmail.PreviewProps = {
  actionLabel: "View changelog",
  actionUrl: "https://acme.feeblo.com/changelog/realtime-collaboration",
  body: "Real-time collaboration is now available — see cursors, live presence, and instant updates as your team works together.",
  eyebrow: "Changelog",
  title: "Real-time collaboration is here",
  unsubscribeUrl:
    "https://app.feeblo.com/api/email-subscriptions/unsubscribe?token=preview",
  coverImageUrl:
    "https://images.unsplash.com/photo-1558655146-d09347e92766?w=1200&q=80&auto=format&fit=crop",
  categories: ["New", "Improvement"],
  organizationName: "Acme",
  publishedAtLabel: "August 21, 2026",
} satisfies ChangelogEmailProps;

export default ChangelogEmail;
