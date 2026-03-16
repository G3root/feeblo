import {
  Body,
  Button,
  Column,
  Container,
  Font,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  pixelBasedPreset,
  Row,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

type EmailShellProps = {
  readonly preview: string;
  readonly title: string;
  readonly eyebrow: string;
  readonly children: ReactNode;
  readonly cta?: {
    readonly label: string;
    readonly href: string;
  };
  readonly footer?: string;
};

export const EmailShell = ({
  children,
  cta,
  eyebrow,
  footer = "This inbox is not monitored.",
  preview,
  title,
}: EmailShellProps) => (
  <Html>
    <Head />
    <Preview>{preview}</Preview>
    <Tailwind
      config={{
        presets: [pixelBasedPreset],
      }}
    >
      <Font
        fallbackFontFamily="Arial"
        fontFamily="Inter"
        webFont={{
          url: "https://fonts.gstatic.com/s/inter/v19/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIa25L7SUc.woff2",
          format: "woff2",
        }}
      />
      <Body
        className="bg-white"
        style={{
          fontFamily: "Inter, Arial, sans-serif",
        }}
      >
        <Container className="mx-auto my-0 max-w-[560px] px-0 pt-5 pb-12">
          <Text className="m-0 font-medium text-[#8892a0] text-[12px] leading-[18px]">
            {eyebrow}
          </Text>
          <Heading className="px-0 pt-[17px] pb-0 font-normal text-[#484848] text-[24px] leading-[1.3] tracking-[-0.5px]">
            {title}
          </Heading>

          <Section className="px-0 py-[18px]">{children}</Section>

          {cta ? (
            <Section className="px-0 py-[12px]">
              <Button
                className="block rounded bg-[#5e6ad2] px-[23px] py-[11px] text-center font-semibold text-[15px] text-white no-underline"
                href={cta.href}
              >
                {cta.label}
              </Button>
            </Section>
          ) : null}

          <Hr className="mt-[42px] mb-[26px] border-[#dfe1e4]" />

          <Section className="px-0 py-0">
            <Row>
              <Column>
                <Text className="m-0 text-[#b4becc] text-[14px]">Feeblo</Text>
                <Text className="mt-2 mb-0 text-[#98a2b3] text-[13px] leading-[20px]">
                  {footer}
                </Text>
              </Column>
            </Row>
          </Section>
        </Container>
      </Body>
    </Tailwind>
  </Html>
);

export const Lead = ({ children }: { readonly children: ReactNode }) => (
  <Text className="mx-0 mt-0 mb-[15px] text-[#3c4149] text-[15px] leading-[1.4]">
    {children}
  </Text>
);

export const Copy = ({ children }: { readonly children: ReactNode }) => (
  <Text className="mx-0 mt-0 mb-[15px] text-[#3c4149] text-[15px] leading-[1.4]">
    {children}
  </Text>
);
