/**
 * Selectable code-block languages for the editor's language dropdown.
 *
 * Values are rangi-accepted language names (canonical keys or aliases), so they
 * can be handed straight to `rangi/tokenize`. Label is the human-readable name
 * shown in the picker. Rangi resolves the common aliases (`ts`, `py`, `shell`,
 * `typescript`, ...) itself, and `plain` maps to the existing "Plain Text"
 * option (an empty language string) so it is excluded here.
 */
export const codeBlockLanguages: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: "ts", label: "TypeScript" },
  { value: "tsx", label: "TSX" },
  { value: "js", label: "JavaScript" },
  { value: "jsx", label: "JSX" },
  { value: "bash", label: "Bash" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "cs", label: "C#" },
  { value: "css", label: "CSS" },
  { value: "csv", label: "CSV" },
  { value: "dart", label: "Dart" },
  { value: "diff", label: "Diff" },
  { value: "docker", label: "Dockerfile" },
  { value: "go", label: "Go" },
  { value: "graphql", label: "GraphQL" },
  { value: "html", label: "HTML" },
  { value: "http", label: "HTTP" },
  { value: "ini", label: "INI" },
  { value: "java", label: "Java" },
  { value: "json", label: "JSON" },
  { value: "kt", label: "Kotlin" },
  { value: "less", label: "Less" },
  { value: "log", label: "Log" },
  { value: "lua", label: "Lua" },
  { value: "make", label: "Makefile" },
  { value: "md", label: "Markdown" },
  { value: "perl", label: "Perl" },
  { value: "php", label: "PHP" },
  { value: "ps1", label: "PowerShell" },
  { value: "py", label: "Python" },
  { value: "rb", label: "Ruby" },
  { value: "rs", label: "Rust" },
  { value: "scss", label: "SCSS" },
  { value: "sql", label: "SQL" },
  { value: "svelte", label: "Svelte" },
  { value: "swift", label: "Swift" },
  { value: "toml", label: "TOML" },
  { value: "uri", label: "URI" },
  { value: "vue", label: "Vue" },
  { value: "xml", label: "XML" },
  { value: "yaml", label: "YAML" },
];

/**
 * Normalize language ids that older documents stored using Shiki's canonical
 * names to the rangi names. Rangi understands most of them already
 * (`typescript`, `python`, `shell`, `dockerfile`, ...); this only remaps the
 * ones whose ids differ. Anything unknown is passed through unchanged and rangi
 * safely falls back to plain text for it.
 */
const SHIKI_TO_RANGI = {
  shellscript: "bash",
  typescriptreact: "tsx",
  javascriptreact: "jsx",
} as const;

export const normalizeCodeBlockLanguage = (language: string): string =>
  // SAFETY: SHIKI_TO_RANGI is a narrow (as const) map; indexing with an
  // arbitrary string is safe here because the `?? language` fallback keeps the
  // returned value valid regardless of whether the key exists.
  SHIKI_TO_RANGI[language as keyof typeof SHIKI_TO_RANGI] ?? language;
