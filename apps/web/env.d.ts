/** biome-ignore-all lint/style/noNamespace: <explanation> */
type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    organizations: import("@feeblo/auth").Session["organizations"] | null;
    session: import("@feeblo/auth").Session["session"] | null;
    subdomain: string | null;
    user: import("@feeblo/auth").Session["user"] | null;
  }
}
