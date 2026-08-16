import * as React from "react";
import { Font } from "react-email";

/**
 * Inter is the only webfont used in transactional email. Each weight maps to
 * the latin variable-font file served by Google Fonts; email clients that do
 * not load webfonts fall back to Arial / sans-serif.
 */
const interUrl =
  "https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2";

const inter = (fontWeight: number) =>
  React.createElement(Font, {
    fallbackFontFamily: ["Arial", "sans-serif"],
    fontFamily: "Inter",
    fontStyle: "normal",
    fontWeight,
    webFont: { url: interUrl, format: "woff2" },
  });

export function FeebloFonts() {
  return (
    <>
      {inter(400)}
      {inter(500)}
      {inter(600)}
    </>
  );
}
