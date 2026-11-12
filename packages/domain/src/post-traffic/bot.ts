/**
 * User agents that are not a person reading a page.
 *
 * The list is deliberately broad: a false positive costs one view, and a false
 * negative puts a crawler in a customer's number. Prefetch and prerender
 * requests are filtered by the tracker before it sends, so this is the
 * server-side backstop.
 */
const BOT_PATTERN =
  /bot|crawl|spider|slurp|scrap|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|statuscake|curl|wget|httpie|python-|aiohttp|go-http-client|okhttp|java\/|axios|node-fetch|undici|libwww|httpclient|facebookexternalhit|embedly|preview|vercel|netlify|feed|rss|validator|checker|archive|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|perplexitybot|ccbot/i;

/** An empty or very short agent is a script or a probe, not a browser. */
const MINIMUM_BROWSER_AGENT_LENGTH = 20;

/**
 * Whether this request should be counted.
 *
 * The bar is intentionally low: a real browser agent is long and names itself.
 * Anything else is dropped rather than stored, because a page view is a claim
 * about a person and the only tool here is the one string the client chose to
 * send.
 */
export const isBotUserAgent = (userAgent: string): boolean =>
  userAgent.trim().length < MINIMUM_BROWSER_AGENT_LENGTH ||
  BOT_PATTERN.test(userAgent);
