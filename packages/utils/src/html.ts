const htmlEntityMap: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeHtmlEntities(value: string) {
  return value.replace(
    /&(#\d+|#x[\da-f]+|[a-z]+);/gi,
    (entity, token: string) => {
      const normalizedToken = token.toLowerCase();

      if (normalizedToken.startsWith("#x")) {
        const codePoint = Number.parseInt(normalizedToken.slice(2), 16);

        return Number.isNaN(codePoint)
          ? entity
          : String.fromCodePoint(codePoint);
      }

      if (normalizedToken.startsWith("#")) {
        const codePoint = Number.parseInt(normalizedToken.slice(1), 10);

        return Number.isNaN(codePoint)
          ? entity
          : String.fromCodePoint(codePoint);
      }

      return htmlEntityMap[normalizedToken] ?? entity;
    }
  );
}

export function htmlToExcerpt(value: string, limit = 160) {
  const excerpt = decodeHtmlEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

  if (excerpt.length <= limit) {
    return excerpt;
  }

  return `${excerpt.slice(0, limit - 3).trimEnd()}...`;
}
