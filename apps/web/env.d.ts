/** biome-ignore-all lint/style/noNamespace: <explanation> */

declare global {
  namespace App {
    interface Locals {
      cfContext?: ExecutionContext;
      log: import("evlog").RequestLogger;
      organizations: import("@feeblo/auth").Session["organizations"] | null;
      session: import("@feeblo/auth").Session["session"] | null;
      subdomain: string | null;
      user: import("@feeblo/auth").Session["user"] | null;
    }
  }
}

export {};
