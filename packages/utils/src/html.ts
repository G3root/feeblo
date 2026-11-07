interface HtmlEntityMap {
  readonly [key: string]: string;
}

const htmlEntityMap: HtmlEntityMap = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

/** `&amp;`, `&#38;`, and `&#x26;`: the three ways HTML spells an entity. */
const htmlEntityPattern = /&(#\d+|#x[\da-f]+|[a-z]+);/gi;
/** A tag, which an excerpt drops in favour of a space. */
const htmlTagPattern = /<[^>]+>/g;
/** Any run of whitespace, collapsed so the excerpt stays one line. */
const whitespaceRunPattern = /\s+/g;

function decodeHtmlEntities(value: string) {
  return value.replace(htmlEntityPattern, (entity, token: string) => {
    const normalizedToken = token.toLowerCase();

    if (normalizedToken.startsWith("#x")) {
      const codePoint = Number.parseInt(normalizedToken.slice(2), 16);

      return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint);
    }

    if (normalizedToken.startsWith("#")) {
      const codePoint = Number.parseInt(normalizedToken.slice(1), 10);

      return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint);
    }

    return htmlEntityMap[normalizedToken] ?? entity;
  });
}

export function htmlToExcerpt(value: string, limit = 160) {
  const excerpt = decodeHtmlEntities(value.replace(htmlTagPattern, " "))
    .replace(whitespaceRunPattern, " ")
    .trim();

  if (excerpt.length <= limit) {
    return excerpt;
  }

  return `${excerpt.slice(0, limit - 3).trimEnd()}...`;
}
