import { Effect } from "effect";
import { AuthConfig } from "./config";

const makeTrustedOrigins = Effect.fnUntraced(function* () {
  const { trustedOrigins, apiUrl, appUrl } = yield* AuthConfig;

  if (trustedOrigins._tag === "Some") {
    const origins = trustedOrigins.value
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);

    if (origins.length > 0) {
      return origins;
    }
  }

  return [appUrl, apiUrl, "*.localhost:3001"];
});

export const getTrustedOrigins = makeTrustedOrigins();

const temporaryEmailDomains = [
  "10minutemail.com",
  "temp-mail.org",
  "fakeinbox.com",
  "tempinbox.com",
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "sharklasers.com",
  "grr.la",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "cool.fr.nf",
  "jetable.org",
  "nospam.ze.tc",
  "nomail.xl.cx",
  "mega.zik.dj",
  "speed.1s.fr",
  "courriel.fr.nf",
  "moncourrier.fr.nf",
  "monemail.fr.nf",
  "monmail.fr.nf",
  "tempr.email",
  "discard.email",
  "discardmail.com",
  "throwawaymail.com",
  "trashmail.com",
  "mailnesia.com",
  "mailnull.com",
  "maildrop.cc",
  "getairmail.com",
  "getnada.com",
  "emailondeck.com",
  "emailfake.com",
  "mohmal.com",
  "tempmail.ninja",
  "temp-mail.io",
  "disposable-email.com",
  "tempmailaddress.com",
  "tempail.com",
  "tempemail.co",
  "tempmail.plus",
  "burnermail.io",
  "spamgourmet.com",
  "mytemp.email",
  "incognitomail.com",
  "mintemail.com",
  "tempmailo.com",
  "temporary-mail.net",
  "mailto.plus",
  "ethereal.mail",
];

// Credit: https://github.com/lukevella/rallly/blob/main/apps/web/src/auth/helpers/temp-email-domains.ts
export const isTemporaryEmail = (email: string): boolean => {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) {
    return false;
  }

  return temporaryEmailDomains.some(
    (blockedDomain) =>
      domain === blockedDomain || domain.endsWith(`.${blockedDomain}`)
  );
};

// Credit: https://github.com/lukevella/rallly/blob/main/apps/web/src/auth/helpers/is-email-blocked.ts
export const isEmailBlocked = (
  email: string,
  allowedEmails: string | undefined
): boolean => {
  if (allowedEmails) {
    const allowedEmailsList = allowedEmails
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e.length > 0);

    if (allowedEmailsList.length > 0) {
      const isAllowed = allowedEmailsList.some((allowedEmail) => {
        const regex = new RegExp(
          `^${allowedEmail
            .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
            .replaceAll(/[*]/g, ".*")}$`,
          "i"
        );
        return regex.test(email);
      });
      if (!isAllowed) {
        return true;
      }
    }
  }

  return false;
};
