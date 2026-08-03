const ASSET_URL_REGEX = /https?:\/\/[^\s"'<>]+/g;
const TRAILING_URL_PUNCTUATION_REGEX = /[),.]+$/;

export const extractAssetUrlsFromContent = (content: string): string[] => [
  ...new Set(
    (content.match(ASSET_URL_REGEX) ?? []).map((url) =>
      url.replace(TRAILING_URL_PUNCTUATION_REGEX, "")
    )
  ),
];
