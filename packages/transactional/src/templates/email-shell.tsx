import * as React from "react";
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Tailwind,
  Text,
} from "react-email";

import { FeebloFonts } from "./fonts";
import { ditherTailwindConfig } from "./theme";

// The feeblo mark is served from the web app's public dir (apps/web/public).
const logoUrl = process.env.APP_URL
  ? `${process.env.APP_URL}/favicon.svg`
  : "https://feeblo.com/favicon.svg";

type EmailShellProps = {
  readonly children: React.ReactNode;
  readonly cta?: {
    readonly label: string;
    readonly href: string;
  };
  readonly companyName?: string;
  readonly footerBlurb?: React.ReactNode;
  readonly homeUrl: string;
  readonly preview: string;
  readonly title: string;
  readonly titleLead?: React.ReactNode;
  readonly titleSize?: "lg" | "md";
  readonly unsubscribeUrl?: string;
};

export const EmailShell = ({
  children,
  cta,
  companyName = "Feeblo",
  footerBlurb = "Feeblo is a feedback board that helps teams collect, organize, and act on what users really want.",
  homeUrl,
  preview,
  title,
  titleLead,
  titleSize = "lg",
  unsubscribeUrl,
}: EmailShellProps) => (
  <Tailwind config={ditherTailwindConfig}>
    <Html>
      <Head>
        <FeebloFonts />
      </Head>

      <Body className="m-0 bg-bg-2 p-0 font-14 font-sans text-fg">
        <Preview>{preview}</Preview>
        <Container className="mx-auto max-w-[600px] bg-bg">
          <Section className="mobile:px-5 px-8 pt-8">
            <Link href={homeUrl}>
              <Img
                alt="Feeblo"
                className="block"
                height={24}
                src={logoUrl}
                width={24}
              />
            </Link>
          </Section>

          <Section className="mobile:px-5 px-8 mobile:pt-8 pt-10 mobile:pb-8 pb-10">
            <Text
              className={`m-0 font-sans text-fg ${
                titleSize === "md" ? "font-24" : "font-28"
              }`}
            >
              {title}
            </Text>
            {titleLead ? (
              <Text className="m-0 mt-4 max-w-[480px] font-15 font-sans text-fg-2">
                {titleLead}
              </Text>
            ) : null}

            {children ? (
              <Section className="mobile:mt-6 mt-8">{children}</Section>
            ) : null}

            {cta ? (
              <Section className="mobile:mt-6 mt-8">
                <Button
                  className="inline-block bg-fg text-center font-sans text-bg"
                  href={cta.href}
                  style={{
                    borderRadius: "6px",
                    fontSize: "14px",
                    fontWeight: 500,
                    lineHeight: "20px",
                    padding: "10px 16px",
                  }}
                >
                  {cta.label}
                </Button>
              </Section>
            ) : null}
          </Section>

          <Section className="border-stroke border-t mobile:px-5 px-8 mobile:py-8 py-10">
            <Text className="m-0 max-w-[420px] font-13 font-sans text-fg-2">
              {footerBlurb}
            </Text>
            <Row align="left">
              <Column className="w-full pt-6 align-top">
                <Text className="m-0 font-11 font-sans text-fg-3">
                  <Link className="text-fg-3" href={homeUrl}>
                    {companyName}
                  </Link>
                  {unsubscribeUrl ? (
                    <>
                      {" "}
                      ·{" "}
                      <Link className="text-fg-3" href={unsubscribeUrl}>
                        Unsubscribe
                      </Link>
                    </>
                  ) : null}
                </Text>
              </Column>
            </Row>
          </Section>
        </Container>
      </Body>
    </Html>
  </Tailwind>
);

export const Lead = ({ children }: { readonly children: React.ReactNode }) =>
  React.createElement(
    Text,
    { className: "m-0 font-15 font-sans text-fg" },
    children
  );

export const Copy = ({ children }: { readonly children: React.ReactNode }) =>
  React.createElement(
    Text,
    { className: "m-0 mt-3 font-14 font-sans text-fg-2" },
    children
  );
