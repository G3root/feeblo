import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

/**
 * The URL a workspace's public portal is served at.
 *
 * One rule, one place. The portal is reachable through a custom domain when the
 * workspace verified one and through `<subdomain>.<root>` otherwise, and the
 * two surfaces that have to name it — a link inside an email and a link inside
 * the widget iframe — must produce the same string. A second copy of this
 * function is how an email and a widget start pointing at different hosts after
 * a rename.
 */
export type PublicSiteHost = {
  readonly subdomain: string;
  readonly customDomain: string | null;
};

/** A scheme prefix and any trailing slashes are not part of a host. */
const urlSchemePattern = /^[a-z][a-z0-9+.-]*:\/\//iu;

const trailingSlashPattern = /\/+$/u;

/**
 * `https://<custom domain>`, or `https://<subdomain>.<root>`.
 *
 * Always `https`, because both a custom domain and a subdomain are served over
 * TLS; there is no plain-HTTP portal to point at, and a scheme carried in the
 * stored value would be a second thing to validate.
 */
export const buildPublicSiteUrl = (
  site: PublicSiteHost,
  appRootDomain: string
): string => {
  if (site.customDomain) {
    const host = site.customDomain
      .replace(urlSchemePattern, "")
      .replace(trailingSlashPattern, "");

    return `https://${host}`;
  }

  return `https://${site.subdomain}.${appRootDomain}`;
};

/**
 * The deployment's root domain, and the app's own origin.
 *
 * `APP_ROOT_DOMAIN` is the tenant root (`feeblo.example`); when it is unset the
 * host of `APP_URL` stands in, which is what keeps a local or single-host
 * deployment's portal links usable instead of `<subdomain>.`.
 *
 * `APP_URL` is read leniently here and strictly in `auth/config.ts`, and the
 * asymmetry is deliberate: authentication cannot work without it, so a
 * deployment that is missing it has already failed loudly, while this service
 * only builds links. Making a link builder strict would turn "the help center's
 * suggestion has a wrong host" into "the widget API does not start", and it
 * would require every test that builds the widget layer to configure an origin
 * it does not use.
 *
 * `appUrl` is kept because not every public link is a portal link: a surface
 * that has no site row to read still needs the app's origin, and reading it
 * here means `APP_URL` is parsed once and validated as a URL.
 */
export class PortalUrlConfig extends Context.Service<PortalUrlConfig>()(
  "PortalUrlConfig",
  {
    make: Effect.gen(function* () {
      const appUrl = yield* Config.schema(Schema.URLFromString, "APP_URL").pipe(
        Config.withDefault(new URL("http://localhost"))
      );

      const configuredRootDomain = yield* Config.String("APP_ROOT_DOMAIN").pipe(
        Config.withDefault("")
      );

      const trimmedRootDomain = configuredRootDomain
        .trim()
        .replace(trailingSlashPattern, "");

      return {
        appUrl: appUrl.href.replace(trailingSlashPattern, ""),
        rootDomain:
          trimmedRootDomain.length > 0 ? trimmedRootDomain : appUrl.host,
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
