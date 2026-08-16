import type { TailwindConfig } from "react-email";
import plugin from "tailwindcss/plugin";

/**
 * A restrained, Vercel-like light palette: white card on a near-white page,
 * near-black text, and hairline gray borders. No accent color — contrast does
 * the work.
 */
const colors = {
  bg: "#ffffff",
  "bg-2": "#fafafa",
  fg: "#171717",
  "fg-2": "#666666",
  "fg-3": "#888888",
  stroke: "#eaeaea",
} as const;

/**
 * Inter-only type scale. Weights are limited to 400 (body), 500 (labels,
 * buttons), and 600 (headings) for a calm, readable hierarchy.
 */
const fontScale = {
  11: {
    fontSize: "11px",
    lineHeight: "1.5",
    letterSpacing: "0.4px",
    fontWeight: "500",
  },
  13: {
    fontSize: "13px",
    lineHeight: "1.6",
    fontWeight: "400",
  },
  14: {
    fontSize: "14px",
    lineHeight: "1.6",
    fontWeight: "400",
  },
  15: {
    fontSize: "15px",
    lineHeight: "1.6",
    fontWeight: "400",
  },
  16: {
    fontSize: "16px",
    lineHeight: "1.6",
    fontWeight: "400",
  },
  20: {
    fontSize: "20px",
    lineHeight: "1.4",
    letterSpacing: "-0.01em",
    fontWeight: "600",
  },
  24: {
    fontSize: "24px",
    lineHeight: "1.3",
    letterSpacing: "-0.02em",
    fontWeight: "600",
  },
  28: {
    fontSize: "28px",
    lineHeight: "1.2",
    letterSpacing: "-0.02em",
    fontWeight: "600",
  },
} as const;

export const ditherTailwindConfig: TailwindConfig = {
  plugins: [
    plugin(({ addUtilities, addVariant }) => {
      addVariant("mobile", "@media (max-width: 600px)");
      const utilities: Record<string, Record<string, string>> = {};
      for (const [step, token] of Object.entries(fontScale)) {
        utilities[`.font-${step}`] = token;
      }
      addUtilities(utilities);
    }),
  ],
  theme: {
    extend: {
      colors,
      fontFamily: {
        sans: ["Inter", "Arial", "sans-serif"],
      },
    },
  },
};
