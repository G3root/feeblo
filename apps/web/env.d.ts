type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare module "@feeblo/feedback-widget/styles";

declare namespace App {
  interface Locals extends Runtime {
    paraglide: {
      lang: string;
      dir: "ltr" | "rtl";
    };
    /** The request path before any rewrite; undefined before the middleware sets it. */
    publicPath?: string;
    site: import("@feeblo/domain/site/schema").TSite | null;
    subdomain: string | null;
  }
}
