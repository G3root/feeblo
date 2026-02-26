/** biome-ignore-all lint/style/noNamespace: <explanation> */

declare namespace App {
  interface Locals {
    organizations: import("@feeblo/auth").Session["organizations"] | null;
    session: import("@feeblo/auth").Session["session"] | null;
    subdomain: string | null;
    user: import("@feeblo/auth").Session["user"] | null;
  }
}
