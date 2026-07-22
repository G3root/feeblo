/** biome-ignore-all lint/style/noNamespace: <explanation> */
type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    authHint: import("@feeblo/web-shared/auth-hint").AuthHint | null;
    organizations: import("@feeblo/auth").Session["organizations"] | null;
    session: import("@feeblo/auth").Session["session"] | null;
    site: import("@feeblo/domain/site/schema").TSite | null;
    subdomain: string | null;
    user: import("@feeblo/auth").Session["user"] | null;
  }
}
