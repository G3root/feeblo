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
// TODO: swap in a properly sized, white-on-transparent logo asset for the dark
// email theme once finalized; favicon.svg is the current stand-in.
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

      <Body className="m-0 bg-bg-2 p-0 font-14 font-sans">
        <Preview>{preview}</Preview>
        <Container className="mx-auto max-w-[640px] bg-bg">
          <Section className="mobile:px-4 px-6 py-6">
            <Link href={homeUrl}>
              <Img
                alt="Feeblo"
                className="block"
                height={32}
                src={logoUrl}
                width={32}
              />
            </Link>
          </Section>

          <Section className="mobile:px-4 px-6 mobile:pt-10 pt-16 mobile:pb-10 pb-12">
            <Section align="left" className="mobile:!max-w-full max-w-[490px]">
              <Text
                className={`mobile:!max-w-full m-0 max-w-[490px] font-condensed text-fg uppercase ${
                  titleSize === "md"
                    ? "font-40 mobile:font-32"
                    : "font-56 mobile:font-40"
                }`}
              >
                {title}
              </Text>
              {titleLead ? (
                <Text className="mobile:!max-w-full m-0 mt-10 max-w-[490px] font-14 font-sans text-fg-2">
                  {titleLead}
                </Text>
              ) : null}
            </Section>

            <Section
              align="left"
              className="mobile:!max-w-full mt-10 max-w-[490px]"
            >
              {children}
            </Section>

            {cta ? (
              <Section className="mt-10">
                <Button
                  className="inline-block bg-fg text-center font-sans text-bg"
                  href={cta.href}
                  style={{
                    fontSize: "15px",
                    fontWeight: 450,
                    lineHeight: "100%",
                    padding: "14px 20px",
                  }}
                >
                  {cta.label}
                </Button>
              </Section>
            ) : null}
          </Section>

          <Section className="border-stroke border-t mobile:px-4 px-6 mobile:py-12 py-16">
            <Text className="m-0 max-w-[320px] font-13 font-sans text-fg-2">
              {footerBlurb}
            </Text>
            <Row align="left">
              <Column className="w-full pt-8 align-top">
                <Text className="m-0 font-11 font-sans text-fg-2">
                  <Link className="text-fg-2" href={homeUrl}>
                    {companyName}
                  </Link>
                  {unsubscribeUrl ? (
                    <>
                      {" "}
                      ·{" "}
                      <Link className="text-fg-2" href={unsubscribeUrl}>
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

export const Lead = ({ children }: { readonly children: React.ReactNode }) => (
  <Text className="m-0 font-15 font-sans text-fg">{children}</Text>
);

export const Copy = ({ children }: { readonly children: React.ReactNode }) => (
  <Text className="m-0 mt-3 font-14 font-sans text-fg-2">{children}</Text>
);
