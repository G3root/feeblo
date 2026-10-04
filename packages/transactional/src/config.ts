import { optionalString } from "@feeblo/config/effect";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

const optionalBoolean = (name: string) =>
  optionalString(name).pipe(
    Effect.flatMap((value) => {
      if (value._tag === "None") {
        return Effect.void;
      }

      if (value.value === "true") {
        return Effect.succeed(true);
      }

      if (value.value === "false") {
        return Effect.succeed(false);
      }

      return Effect.fail(
        new Config.ConfigError(
          new ConfigProvider.SourceError({
            message: `Expected ${name} to be "true" or "false", received "${value.value}"`,
          })
        )
      );
    })
  );

const optionalInteger = (name: string) =>
  optionalString(name).pipe(
    Effect.flatMap((value) => {
      if (value._tag === "None") {
        return Effect.void;
      }

      const parsed = Number(value.value);
      return Number.isInteger(parsed)
        ? Effect.succeed(parsed)
        : Effect.fail(
            new Config.ConfigError(
              new ConfigProvider.SourceError({
                message: `Expected ${name} to be an integer, received "${value.value}"`,
              })
            )
          );
    })
  );

/**
 * Right-hand side of every Message-ID this application generates.
 *
 * This must be a domain the deployment controls: a Message-ID whose domain is
 * not a real host — a bare label, say — is a deliverability signal, because a
 * receiving provider cannot resolve it against the sender the message claims
 * to be from. It lives here rather than in the mailer so that reading it does
 * not pull nodemailer and React into the import graph of a database module.
 *
 * It must stay byte-identical to the value persisted in
 * `email_delivery.message_id`. The SES feedback webhook correlates a bounce or
 * complaint back to a delivery by matching the Message-ID the provider echoes
 * against that column, so a value that differs between the row and the sent
 * header breaks bounce attribution silently instead of failing loudly.
 *
 * A self-hosted deployment that sends from its own domain should change this
 * to a subdomain of it. The value is shared rather than derived from
 * SMTP_FROM_ADDRESS so that the persisted row and the sent header cannot drift
 * apart.
 */
export const MESSAGE_ID_DOMAIN = "notifications.feeblo.com";

/**
 * Characters RFC 5322 allows unquoted in a display name (`atom`, plus spaces
 * between atoms). Anything else — the comma in `Feeblo, Inc`, a leading dot —
 * has to be a quoted-string, or the `From` header is malformed and a receiving
 * provider may reject the message or render the sender wrongly.
 */
const displayNameAtomPattern = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]+$/;

const quoteDisplayName = (displayName: string): string =>
  displayNameAtomPattern.test(displayName)
    ? displayName
    : `"${displayName.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/**
 * Renders a `From` value, folding in an optional display name.
 *
 * An address that already carries a display name is treated as a complete
 * mailbox and returned unchanged: the environment has stated the name, and
 * prepending another would nest one name inside the other.
 */
const formatFromAddress = (
  address: string,
  displayName: Option.Option<string>
): string => {
  const mailbox = address.trim();
  if (Option.isNone(displayName)) {
    return mailbox;
  }

  const name = displayName.value.trim();
  if (name === "" || mailbox.includes("<")) {
    return mailbox;
  }

  return `${quoteDisplayName(name)} <${mailbox}>`;
};

export class MailerConfig extends Context.Service<MailerConfig>()(
  "MailerConfig",
  {
    make: Effect.gen(function* () {
      const host = yield* optionalString("SMTP_HOST").pipe(
        Effect.map((value) =>
          value._tag === "Some" ? value.value : "127.0.0.1"
        )
      );
      const port = yield* optionalInteger("SMTP_PORT").pipe(
        Effect.map((value) => value ?? 2500)
      );
      const secure = yield* optionalBoolean("SMTP_SECURE").pipe(
        Effect.map((value) => value ?? false)
      );
      const ignoreTLS = yield* optionalBoolean("SMTP_UNSAFE_IGNORE_TLS").pipe(
        Effect.map((value) => value ?? false)
      );
      const service = yield* optionalString("SMTP_SERVICE");
      const username = yield* optionalString("SMTP_USERNAME");
      const password = yield* Config.Redacted("SMTP_PASSWORD").pipe(
        Config.option
      );
      const defaultFromAddress = yield* optionalString(
        "SMTP_FROM_ADDRESS"
      ).pipe(
        Effect.map((value) =>
          value._tag === "Some" ? value.value : "hello@feeblo.com"
        )
      );
      const defaultFromName = yield* optionalString("SMTP_FROM_NAME");
      const defaultFrom = formatFromAddress(
        defaultFromAddress,
        defaultFromName
      );
      // Personal lifecycle emails (user onboarding, user feedback) can use a
      // dedicated sender distinct from SMTP_FROM_ADDRESS. When unset, the
      // defaultFrom is used. Exposed as an Option so senders can decide
      // whether to override per message.
      //
      // The name is a separate variable rather than a fallback to
      // SMTP_FROM_NAME: a personal sender is meant to read as a person, and
      // inheriting the company display name would label the human's mailbox
      // with the product's name instead.
      const personalFromAddress = yield* optionalString(
        "SMTP_PERSONAL_FROM_ADDRESS"
      );
      const personalFromName = yield* optionalString("SMTP_PERSONAL_FROM_NAME");
      const personalFrom = Option.map(personalFromAddress, (address) =>
        formatFromAddress(address, personalFromName)
      );
      // Where a reply is delivered. Transactional senders are routinely an
      // address that cannot receive (`noreply@`), so without this a recipient
      // who hits Reply reaches a mailbox nobody reads and the reply is lost
      // with no bounce. A message-level `replyTo` overrides it per send.
      const replyTo = yield* optionalString("SMTP_REPLY_TO_ADDRESS");

      return {
        defaultFrom,
        host,
        ignoreTLS,
        password,
        personalFrom,
        port,
        replyTo,
        secure,
        service,
        username,
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
