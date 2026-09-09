import { Button } from "@feeblo/ui/button";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@feeblo/ui/menu";
import { LanguageCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { m } from "../../paraglide/messages.js";
import {
  getLocale,
  type Locale,
  locales,
  setLocale,
  toLocale,
} from "../../paraglide/runtime.js";

// Autonyms: language names stay in their own language.
const localeLabels = {
  en: "English",
  de: "Deutsch",
  zh: "中文",
  es: "Español",
  fr: "Français",
  pt: "Português",
  ru: "Русский",
  ar: "العربية",
} satisfies Record<Locale, string>;

/**
 * Locale picker for the public board. `setLocale` is the host runtime
 * injected by the island wrapper: it writes the locale cookie and reloads the
 * document, so the board and the shared post UI re-render in the new locale
 * together (and the inline locale script re-applies `<html lang dir>` before
 * the new document paints).
 */
export function LocaleSwitcher() {
  const currentLocale = getLocale();

  return (
    <Menu>
      <MenuTrigger
        render={(props) => (
          <Button
            {...props}
            aria-label={m.fine_tame_octopus()}
            size="icon-sm"
            variant="ghost"
          >
            <HugeiconsIcon icon={LanguageCircleIcon} strokeWidth={2} />
          </Button>
        )}
      />
      <MenuPopup align="end" className="w-40">
        <MenuRadioGroup
          onValueChange={(nextLocale) => {
            const locale = toLocale(nextLocale);
            if (locale && locale !== currentLocale) {
              void setLocale(locale);
            }
          }}
          value={currentLocale}
        >
          {locales.map((locale) => (
            <MenuRadioItem closeOnClick key={locale} value={locale}>
              {localeLabels[locale]}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
