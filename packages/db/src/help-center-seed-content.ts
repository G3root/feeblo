/**
 * The help center a fresh seed publishes.
 *
 * Written as data rather than as `db.insert` calls so the prose can be read and
 * edited without stepping through the seeder, and typed so a section cannot name
 * an article key that does not exist. The seed inserts these as `published`
 * articles by the primary user, which means a newly seeded workspace has a help
 * center a reader can actually navigate — empty documentation is the state that
 * makes a help center look broken.
 *
 * Every statement here is about this product's own screens: the paths, the
 * setting names and the plan limits are the ones in `apps/web` and
 * `plan-entitlements.ts`. A doc that describes an interface the reader cannot
 * find is worse than no doc.
 */

export type HelpCenterSeedArticle = {
  readonly slug: string;
  readonly title: string;
  /** Markdown. Headings are `##` and below; the title is rendered above them. */
  readonly content: string;
  /** How long before the seed run the article was published. */
  readonly publishedDaysAgo: number;
};

export type HelpCenterSeedTopic = {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  /** A Tabler filled icon name, as the dashboard's picker stores it. */
  readonly icon: string;
  readonly articles: ReadonlyArray<HelpCenterSeedArticle>;
};

export const HELP_CENTER_SEED_TOPICS: ReadonlyArray<HelpCenterSeedTopic> = [
  {
    slug: "getting-started",
    name: "Getting started",
    description:
      "Create a workspace, invite your team, and collect the first post.",
    icon: "bolt",
    articles: [
      {
        slug: "what-is-feeblo",
        title: "What is Feeblo?",
        publishedDaysAgo: 120,
        content: `Feeblo is a customer feedback platform. It gives you one place to collect what customers ask for, decide what to work on, and tell people when it ships.

## The four surfaces

| Surface | What it is for |
| --- | --- |
| **Feedback board** | Customers submit posts and upvote each other's. This is where demand becomes visible. |
| **Roadmap** | The statuses you publish, so customers can see what is planned, in progress and shipped. |
| **Changelog** | Release notes, so shipped work reaches the people who asked for it. |
| **Help center** | Documentation your customers read before they ask you anything. |

All four are readable without a dashboard session, and the embeddable widget brings the board, your updates and your help center inside your own product.

## The unit of everything

A **post** is one piece of feedback: a feature request, a bug report or a suggestion. Posts live on **boards**, move through **statuses**, and can be linked to changelog entries when they ship.

A post is not a ticket. It has one assignee at most, it collects upvotes and comments from everyone who wants it, and it keeps its history when it moves.

## Who it is for

Teams that already receive feedback in four different places — support mail, chat, calls, a spreadsheet — and want one list they can order. If you only need a changelog, or only need a help center, both of those work on their own.

## Next

- [Set up your workspace](/help/articles/set-up-your-workspace)
- [Boards and views](/help/articles/boards-and-views)
- [Collect feedback](/help/articles/collect-feedback)`,
      },
      {
        slug: "set-up-your-workspace",
        title: "Set up your workspace",
        publishedDaysAgo: 118,
        content: `A workspace takes about five minutes to set up. Everything below happens in the dashboard, and you need to be the workspace owner or an administrator.

## 1. Name the workspace

The name appears in the sidebar, on the public page and in notification emails. Rename it any time from **Settings → Workspace**.

## 2. Pick your public address

Every workspace gets a subdomain that serves the portal: the feedback board, roadmap, changelog and help center.

\`\`\`
yourworkspace.feeblo.app
\`\`\`

A custom domain can point at the same portal later. See [Branding and domains](/help/articles/branding-and-domains).

## 3. Create your first board

New workspaces start with **Features** and **Bugs**. Rename them, delete them, or add a board per product area — "Mobile app", "Billing", "API". You can see how many boards your plan allows under **Settings → Billing**.

## 4. Invite the team

Go to **Settings → Members**. Members can triage feedback, publish releases and answer in the help center; the role you pick decides how much of the workspace they can change. See [Members and roles](/help/articles/members-and-roles).

## 5. Publish something

A board with nothing on it does not show a customer what the page is for. Two things make an empty portal look alive:

- Post the three requests you already know customers want.
- Publish a changelog entry announcing that the portal exists.

## 6. Show it to customers

Post the link, or embed the widget in your app so customers never leave it. The snippet is on **Settings → Widget**, and the integration guide is in [Embed the widget](/help/articles/embed-the-widget).`,
      },
      {
        slug: "members-and-roles",
        title: "Members and roles",
        publishedDaysAgo: 112,
        content: `Everyone who works in the dashboard is a member of one workspace, with one role.

## The roles

| Role | Can do |
| --- | --- |
| **Owner** | The account that created the workspace. Everything an administrator can do, plus transferring the workspace. |
| **Admin** | Everything: workspace settings, billing, members, boards, branding, integrations, the Public API. |
| **Manager** | Content: triage and edit posts, manage statuses, tags, roadmap and changelog, import and export, create and update CRM records, invite contributors. |
| **Contributor** | Day-to-day participation: comment, vote on behalf, move posts between boards. Sees the workspace but cannot change how it is configured. |

Permissions are inherited downwards: an admin can do everything a manager can, and a manager everything a contributor can. The full matrix lives in the product, not in this article — if a button is missing, the role is why.

## Invite someone

1. Open **Settings → Members**.
2. Choose **Invite member** and enter their email.
3. Pick a role. Contributor and manager accounts can be created by a manager; admins only by an admin.

The invitation email carries a link that signs the person in and joins them to the workspace. Invitations expire; sending a new one replaces the old link.

## Change a role

Open the member's menu in **Settings → Members** and pick the new role. The change applies immediately, and the member keeps everything they wrote.

## Remove someone

Removing a member never deletes their posts, comments or changelog entries: those are the workspace's history and they stay, attributed to the person who wrote them.

## Plan limits

| Plan | Members |
| --- | --- |
| Free | 2 |
| Starter | 5 |
| Professional | Unlimited |

A workspace at its limit cannot send a new invitation until a member is removed or the plan changes. Free workspaces also allow three workspaces per account.`,
      },
    ],
  },
  {
    slug: "feedback-boards",
    name: "Feedback boards",
    description:
      "Where posts live, how they are triaged, and how votes arrive.",
    icon: "layout",
    articles: [
      {
        slug: "boards-and-views",
        title: "Boards and views",
        publishedDaysAgo: 108,
        content: `## Boards are containers

A board groups posts by area: a product, a platform, or a team. Every post belongs to exactly one board, and the board decides where a customer's post lands when they submit from the portal or the widget.

Create one from **Settings → Boards**, or from the board switcher in the sidebar. Rename it, give it an icon, and decide whether it is public or private.

## Views are what the board is showing

The same posts, cut four ways:

| View | What it shows |
| --- | --- |
| **All feedback** | Everything on the board, newest first. |
| **Active** | Posts that are neither completed nor closed — the working list. |
| **Backlog** | Posts that are accepted but not scheduled. |
| **Saved view** | Whatever filters you stored under a name. |

A view is a filter set, not a copy: moving a post out of a filter changes what the view shows and nothing else.

## Saved views

Build the filter you want — status, tag, assignee, date range — then choose **Save view**. Give it a name and an optional description.

A saved view has its own address, so a link to one is a link to a result set rather than to a filter mode. Views are visible to every member of the workspace unless you mark yours private.

## Public and private boards

A **public** board is readable on the portal: customers browse it, submit posts, vote and comment. A **private** board is visible to workspace members only — use it for feedback you collect internally, or for a customer segment you do not want to publish.

Private boards are available on Starter and Professional.

## Search

The board's search reads post titles, bodies and comments. It is the fastest way to answer "did someone already ask for this?" before you triage, which is the first thing to do with a new post.`,
      },
      {
        slug: "triage-feedback",
        title: "Triage feedback",
        publishedDaysAgo: 96,
        content: `Triage is deciding what a post is, who owns it, and where it stands. Every post needs those three answers, and the dashboard is built to give them in a few seconds.

## Status

**Statuses** are the workspace's own vocabulary for where a post is. Every workspace starts with six:

| Status | Type | Meaning |
| --- | --- | --- |
| **Pending** | PENDING | New, not yet read. |
| **Under review** | REVIEW | Being considered. |
| **Planned** | PLANNED | Accepted and scheduled. |
| **In progress** | IN_PROGRESS | Being built. |
| **Completed** | COMPLETED | Shipped. |
| **Closed** | CLOSED | Won't do, duplicated or out of scope. |

Rename them, recolour them, reorder them and add your own in **Settings → Statuses**. A status's **type** is what the product reasons about — the roadmap shows the *planned* type, the changelog links the *completed* type — so renaming a status never changes its behaviour.

## Assignee

One member can own a post. An unassigned post is normal, not an error: most incoming feedback is nobody's job yet. Filters and saved views can find the posts with no assignee, which is the list a triage pass actually works through.

## Tags

Tags cut across boards: "enterprise", "mobile", "performance". Use them for anything you want to slice by regardless of where the post lives. Manage the set in **Settings → Feedback tags**, and attribute them in **Settings → Custom attributes** if you need per-customer detail rather than per-post.

## Duplicates

When two posts ask for the same thing, merge them. The merge keeps one survivor, moves the other's votes and comments onto it, and closes the original with a pointer to where the conversation continued. Merging is reversible: unmerge restores the original with its votes.

A customer whose post is merged keeps following the survivor, so they still get an email when it ships.

## On behalf of

Someone tells you about a request in a call, a support thread or a conference. **Create post** from the dashboard records it as if the customer had submitted it — attributed to them, with their vote — so the demand is counted where it happened rather than in a note nobody reads.

## Archive and lock

Locking stops new comments; archiving hides a post from the active list while keeping the link working. Neither is a delete.`,
      },
      {
        slug: "collect-feedback",
        title: "Collect feedback",
        publishedDaysAgo: 84,
        content: `There are five ways a post reaches a workspace. All of them end in the same board, so triage is one place.

## 1. The public board

Customers open your portal, pick a board and post. They can search for an existing request first, and upvote it instead of writing a duplicate.

Control who can do this in **Settings → Workspace**: whether visitors can read the portal without an account, and whether they can submit and vote without one.

## 2. The embeddable widget

The widget puts the board, your updates and your help center inside your product, so a customer can vote — or find the answer without voting — without leaving the page they are on. Install it from **Settings → Widget** — see [Embed the widget](/help/articles/embed-the-widget).

## 3. Slack and Discord

Both integrations ship a slash command and a message action that open a small feedback form: title, details, board. The post is created in the workspace and attributed to the person in chat. See [Connect Slack](/help/articles/connect-slack) and [Connect Discord](/help/articles/connect-discord).

## 4. The Public API

Scripts, CI and internal tools can create posts over HTTP with an API key, or through the MCP endpoint for an assistant. See [Use the Public API](/help/articles/public-api).

## 5. CSV import

Bring an existing backlog over from a spreadsheet or another tool. See [Import and export posts](/help/articles/import-and-export).

## What a customer can do

| Action | Requires |
| --- | --- |
| Read the board | Nothing, if the board is public |
| Submit a post | An account, or a visitor session if anonymous submissions are on |
| Upvote | The same |
| Comment | The same |
| Subscribe to a post | An email address — they get an email when its status changes |

## Getting the first posts

The board is only useful once it carries real demand. Post the requests you already know about — from support threads, sales calls, the last month of chat — so a customer arriving at an empty board finds their question already asked and upvotes it instead of leaving.`,
      },
    ],
  },
  {
    slug: "roadmap-and-changelog",
    name: "Roadmap and changelog",
    description: "Show what you are working on, and tell people when it ships.",
    icon: "map-pin",
    articles: [
      {
        slug: "plan-a-roadmap",
        title: "Plan a roadmap",
        publishedDaysAgo: 78,
        content: `The roadmap is the public answer to "what are you working on?". It reads the same posts the board does — moving a post's status moves it on the roadmap, and there is no second list to keep in sync.

## What appears

A roadmap shows posts whose status belongs to the roadmap. Choose which statuses count in **Settings → Roadmap**, and the order they appear in. Two workspaces can publish very different roadmaps from the same six statuses.

## Grouping

Posts are grouped by status column, and each column is ordered by the roadmap's own sort — newest, most voted, or the manual order you set. The manual order is worth using for a small public roadmap: it is the only one that can put "next" above "eventually".

## Visibility

| Setting | Effect |
| --- | --- |
| **Public** | The roadmap is a tab on your portal and inside the widget. |
| **Hidden** | The roadmap is not served at all — not only hidden from navigation. |

Change it in **Settings → Roadmap**. A hidden roadmap answers 404 on its own path, so hiding it is not a way to soft-launch it: nothing is readable while it is hidden.

A **private** roadmap, where only signed-in customers see it, is available on Starter and Professional.

## What not to put on it

Commitments you have not made. A public roadmap is a promise-shaped object: customers read "Planned" as a date. If a column means "we talked about it", name it that way, or leave those posts out of the visible statuses.`,
      },
      {
        slug: "publish-a-changelog",
        title: "Publish a changelog",
        publishedDaysAgo: 72,
        content: `The changelog is where shipped work reaches the people who asked for it. Publishing an entry, and linking the posts it completes, sends those customers an email — which is the whole point of collecting the request in the first place.

## Write an entry

1. Open **Changelog** in the sidebar.
2. Choose **New entry**.
3. Write a title, the body, and pick one or more **categories**.

The body is Markdown, with a toolbar for headings, lists, links, code and images. Pasted images are uploaded when you save.

## Draft, schedule, publish

| State | Meaning |
| --- | --- |
| **Draft** | Saved, invisible to customers. |
| **Scheduled** | Written and dated; becomes public at that time. |
| **Published** | Live on the portal, in the widget and in the RSS feed. |

Scheduling is how a Friday release note comes out on Monday morning.

## Link the posts it ships

The entry editor has a place to attach posts. Every attached post's status moves with the release, and every customer who upvoted or subscribed to one gets the email. This is the step that closes the loop: without it the changelog is a blog.

## Categories

Categories are the changelog's own exact vocabulary — "New", "Improved", "Fixed" — with an icon and a colour. Free workspaces get three; Starter and Professional get as many as you need. Manage them in **Settings → Changelog categories**.

## Subscribers

Customers can subscribe to the changelog with an email address and receive every published entry. Subscriber email is available on Starter and Professional; the entry, the feed and the portal page are available on every plan.

## The feed

\`\`\`
https://yourworkspace.feeblo.app/changelog/rss.xml
\`\`\`

The RSS feed carries published entries with their full body, so a customer with a reader, or a tool that watches feeds, does not need an account.

## Hiding the changelog

The portal tab, the RSS feed and the widget tab all disappear together when you set the changelog to **Hidden** in **Settings → Changelog privacy**. Entries stay in the dashboard and keep their addresses for your team.`,
      },
    ],
  },
  {
    slug: "help-center",
    name: "Help center",
    description:
      "Publish documentation next to the board, and learn what it does not answer.",
    icon: "lifebuoy",
    articles: [
      {
        slug: "write-a-help-article",
        title: "Write a help article",
        publishedDaysAgo: 64,
        content: `The help center is documentation you publish on your portal. It is grouped into **topics** — sections like "Getting started" or "Billing" — and each topic holds articles.

## Create a topic

1. Open **Help center** in the sidebar.
2. Choose **New topic**, name it, and pick an icon.

A topic has a name, a slug, an optional description and an icon. It is the article's only container, so an article belongs to exactly one topic.

## Write an article

1. Open a topic and choose **New article**.
2. Write a title and the body.
3. Save as a draft until it is ready.

The body is Markdown with a formatting toolbar; a cover image is optional. Pasted images are uploaded when you save.

## The slug is chosen at publish

The article's URL is set in the publish dialog, not in the editor. That is deliberate: a save cannot move a live page's address, so a reader's bookmark keeps working because editing the title never rewrites the URL.

## States

| State | What a reader sees |
| --- | --- |
| **Draft** | Nothing. Drafts are not served on the portal. |
| **Published** | The article, in its topic, in search. |
| **Archived** | The article, with a notice that it describes behaviour that is no longer current. |

Archiving is how documentation is retired. The link still resolves, so an old answer says it is out of date instead of 404ing — and the topics that hold only archived articles stop being listed.

## What readers get

Every published article carries three things beyond the body:

- **A view count**, incremented once per reader per tab session.
- **"Was this helpful?"** with an optional reason for a no.
- **Copy as Markdown**, which copies the stored source rather than the rendered page.

A reader has only two inputs of their own: the verdict and the search box. What they search for, and what they searched for and did not find, is what [Help center insights](/help/articles/help-center-insights) reports.

## What the article writes

Write for the reader who has the product open in another tab. Name the screen a control is on, use the interface's own words, and put the version of the steps someone will follow — not the reasoning behind them. A doc that explains the architecture is a blog post.

## Limits

| Plan | Articles |
| --- | --- |
| Free | 25 |
| Starter | Unlimited |
| Professional | Unlimited |

Topics are not counted: a workspace at its article ceiling can still reorganise what it has.`,
      },
      {
        slug: "help-center-insights",
        title: "Read help center insights",
        publishedDaysAgo: 58,
        content: `The help center answers two questions about itself: what people read, and what they looked for and did not find.

Open **Insights → Help center**. Every panel covers a window of 7, 30 or 90 days, counted as UTC calendar days including today.

## Views

How many times each article was read in the window, and the all-time total on the article's own page.

A view is one read, not one person: the count comes from a beacon fired once per article per tab session, and the server deduplicates on the beacon's own id so a retried beacon is not a second read. No visitor is identified — there is no IP address, cookie or fingerprint stored with a view.

## Verdicts

Helpful and not-helpful counts per article, as they were **cast in the window** — a verdict flipped today counts today as a flip, while the article page shows the standing distribution. The two numbers answer different questions and will not always agree.

The reader's optional reason is attached to an unhelpful verdict and is only visible in the dashboard, never on the portal.

## Searches

Every search typed on the portal is recorded with its normalised text — lowercased, whitespace collapsed — and whether it returned anything.

| Panel | What it tells you |
| --- | --- |
| **Top searches** | What readers assume you document. |
| **Searches with no results** | The documentation you do not have yet. |

The second panel is the useful one. A search that returns nothing is a request: either the article does not exist, or it exists under a word the reader would not have guessed.

## What is not recorded

A query with no searchable term — punctuation, or a box the reader cleared — is not recorded at all, because it can never match and counting it would fill both panels with noise. Searches and views are pruned after 90 days; the all-time view counter on an article is not.

## Using it

Read the empty-search list every few weeks and write one article for the most common gap. Two or three iterations of that are worth more than a documentation sprint nobody asked for.`,
      },
    ],
  },
  {
    slug: "integrations",
    name: "Integrations",
    description: "Slack, Discord, GitHub and webhooks.",
    icon: "affiliate",
    articles: [
      {
        slug: "connect-slack",
        title: "Connect Slack",
        publishedDaysAgo: 52,
        content: `The Slack integration sends new posts to a channel and brings feedback in from Slack. Integrations are available on Starter and Professional, and only an administrator can connect one.

## Connect

1. Open **Settings → Integrations → Slack**.
2. Choose **Connect Slack** and approve the request. Feeblo installs a bot into the workspace you pick.
3. Choose which channels receive new posts.

## Outbound: new posts in a channel

Every channel you add is its own route. When a post is created, Feeblo posts a card to each route: title, details, the board it landed on, and a link to the post.

Public channels are joined automatically. A private channel needs a member to add the bot first — Slack does not let the bot add itself.

## Inbound: feedback from Slack

Two entry points open the same small form — title, details, board:

- the \`/feeblo\` slash command, from any channel;
- **Send to Feeblo**, from any message's menu, which pre-fills the message.

Submitting creates a post attributed to the person in Slack. Their Slack email is matched against accounts in the workspace, so a colleague who already has an account is the same person; anyone else becomes an end user identified by their Slack handle.

The person who filed it is not subscribed to the post unless they do it themselves on the portal.

## Disconnect

**Settings → Integrations → Slack** lists the connection and every channel route. Removing a route stops deliveries to that channel; disconnecting removes the installation and every route with it. Posts created from Slack stay where they are.`,
      },
      {
        slug: "connect-discord",
        title: "Connect Discord",
        publishedDaysAgo: 48,
        content: `The Discord integration does what the Slack one does, against a server instead of a workspace. Integrations are available on Starter and Professional.

## Connect

1. Open **Settings → Integrations → Discord**.
2. Choose **Connect Discord**, pick the server, and approve the requested permissions.
3. Choose which channels receive new posts.

The bot asks for View Channels, Send Messages, Embed Links and Read Message History. A server administrator can narrow that per channel afterwards — a channel where the bot cannot send simply receives nothing.

## Outbound: new posts in a channel

Every channel you add is a route. Each new post is posted as an embed with the post's title, details, board and a link.

## Inbound: feedback from Discord

- \`/feeblo\` opens the feedback form in any channel the bot can see.
- **Send to Feeblo** on a message opens the same form with the message already in it.

Submitting creates a post attributed to the person who ran the command. Discord does not share email addresses with bots, so a Discord author is always a distinct end user — unlike Slack, where an existing account can be matched.

## Disconnect

Removing a channel route stops deliveries to that channel. Disconnecting removes the installation and all routes; posts created from Discord are unaffected.`,
      },
      {
        slug: "link-github-issues",
        title: "Link GitHub issues",
        publishedDaysAgo: 44,
        content: `The GitHub integration turns a post into an issue and keeps the post's status in step with the issue's state.

## Connect

1. Open **Settings → Integrations → GitHub**.
2. Choose **Connect GitHub** and install the app on the repositories you want to use.

Only an administrator can install it, and the installation decides which repositories are visible to the workspace.

## Create an issue from a post

Open a post and choose **Create GitHub issue**. The issue carries the post's title and body, and the bot comments a link back to the post so a developer reading the issue knows where the feedback came from.

Linking an existing issue instead keeps the issue's own title and body, and still leaves the backlink comment. Either way, the issue is recorded on the post as an external link — several posts can point at one issue.

## Keep statuses in sync

An issue's state changes in GitHub, and Feeblo applies the sync rules the workspace configured: a rule maps a GitHub state — opened or closed — onto one of your statuses. Change the rules in **Settings → Integrations → GitHub**.

Sync is one-directional: Feeblo reads GitHub. Changing a status in Feeblo never edits the issue, so a triage pass cannot rewrite a repository's history.

When a rule moves a post, the people who upvoted or subscribed to it are notified exactly as they would be for a status change made by hand.

## What it does not do

- It does not read issue comments into the post.
- It does not create issues for every new post — creating one is a decision, not a default.`,
      },
      {
        slug: "send-webhooks",
        title: "Send webhooks",
        publishedDaysAgo: 40,
        content: `Webhooks push workspace events to an endpoint you run, so another system can react without polling the API.

## Connections and routes

Two levels, deliberately:

| Level | What it holds |
| --- | --- |
| **Connection** | One endpoint URL and its signing secret. |
| **Route** | Which event types that endpoint receives. |

One endpoint with one route per event type means adding an event does not mean creating a second connection. Manage both in **Settings → Webhooks**.

## Events

| Event | Fires when |
| --- | --- |
| \`post.created\` | A post is submitted, from any surface. |
| \`post.status_changed\` | A post moves to a different status. |

Every delivery is a versioned snapshot: the values are the ones that were true when the event was recorded, not the row's current state, so a retry 24 hours later still describes the event it was sent for. Ignore fields you do not know, and ignore event types you do not handle — new fields may appear within a version.

## Verify the signature

Requests carry the Standard Webhooks headers:

| Header | Meaning |
| --- | --- |
| \`webhook-id\` | The delivery id, stable across retries. Deduplicate on it. |
| \`webhook-timestamp\` | When this attempt was signed. |
| \`webhook-signature\` | The signature over the raw body and timestamp. |
| \`x-feeblo-event\` | The event type. |

Verify against the raw bytes before parsing JSON — a re-serialised body will not match.

## Delivery and retries

A delivery is retried with backoff for up to 24 hours. Answer \`2xx\` as soon as you have durably accepted the event, and do the slow work afterwards: a slow endpoint is retried as a failure.

Endpoints must be HTTPS and publicly reachable. Localhost, private networks and cloud metadata addresses are rejected at configuration time and re-checked on every delivery.

## Testing

**Send test event** posts a \`webhook.test\` delivery to the connection. It follows the real signing and delivery path, so a test that arrives verifies proves the endpoint, the secret and the network path all work. A route cannot select it.`,
      },
    ],
  },
  {
    slug: "developers",
    name: "Developers",
    description: "The Public API, API keys, MCP, and moving data in and out.",
    icon: "code-circle",
    articles: [
      {
        slug: "public-api",
        title: "Use the Public API",
        publishedDaysAgo: 34,
        content: `The Public API reads and writes a workspace's own data over HTTP. It is versioned, available on Starter and Professional, and authenticated with an API key.

## Base URL and version

\`\`\`
https://api.feeblo.app/api/v1
\`\`\`

Every path is under \`/api/v1\`. A breaking change would arrive as \`/api/v2\`; within \`v1\` new fields are additive.

## Authenticate

Send the key in the \`x-api-key\` header:

\`\`\`bash
curl -s https://api.feeblo.app/api/v1/boards \\
  -H "x-api-key: $FEEBLO_API_KEY"
\`\`\`

Create keys in **Settings → Developers**. A key is scoped and never gains a scope afterwards — see [API keys and scopes](/help/articles/api-keys-and-scopes).

## Endpoints

| Method and path | Purpose |
| --- | --- |
| \`GET /boards\` | List the workspace's boards. |
| \`GET /boards/{boardId}\` | One board. |
| \`GET /boards/{boardId}/posts\` | Posts on a board. |
| \`GET /posts\` | Posts across boards, with filters. |
| \`GET /statuses\` | The workspace's statuses. |
| \`POST /posts\` | Create a post. |

The complete list, with parameters and response shapes, is the OpenAPI document:

- \`GET /api/v1/openapi.json\` — the document itself.
- \`GET /api/v1/docs\` — a browsable reference rendered from it, with an Authorize button for trying requests.

## Pagination

List endpoints take \`limit\` and \`offset\` and answer a \`data\` array. Read until a page comes back shorter than the limit you asked for rather than counting on a total.

## Errors

Errors share one envelope and one status per class:

| Status | Meaning |
| --- | --- |
| \`401\` | No key, or a key that no longer exists. |
| \`403\` | The key lacks the scope the endpoint needs. The body names it. |
| \`404\` | The record does not exist in this workspace. |
| \`422\` | The body or query did not decode. |
| \`429\` | Rate limit exhausted. |

## Rate limits

Responses carry \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\` and \`X-RateLimit-Reset\`. The budget is per key; a key that exhausts it is refused until the window resets. Retry with backoff on \`429\` rather than in a tight loop.

## Discovery

An agent should not need a person to tell it what the API is:

| Document | Path |
| --- | --- |
| Markdown landing | \`GET /\` and \`GET /llms.txt\` |
| Auth guide | \`GET /auth.md\` |
| API catalog | \`GET /.well-known/api-catalog\` |
| MCP server card | \`GET /.well-known/mcp.json\` |

These never read the database, so an outage that fails \`/api/v1\` still answers them.

## MCP

The same operations are exposed over the Model Context Protocol:

- \`POST /mcp\` — one tool per operation, for a client that speaks MCP.
- \`POST /mcp/code\` — two tools, \`search\` and \`execute\`, for a client that would rather run one program than call several.

Both accept the API key in \`x-api-key\`, or an OAuth 2.1 access token in \`Authorization: Bearer\` for a hosted client that discovered the authorization server. Scopes, the plan gate and the rate limit apply exactly as they do over HTTP.`,
      },
      {
        slug: "api-keys-and-scopes",
        title: "API keys and scopes",
        publishedDaysAgo: 30,
        content: `An API key is a credential for the Public API and the MCP endpoint. It belongs to one workspace, and its scopes are fixed when it is created.

## Create a key

1. Open **Settings → Developers**.
2. Choose **Create API key**.
3. Name it after the thing that will use it — "Zapier", "release script", "data warehouse".
4. Choose its scopes.
5. Copy the key. It is shown once and stored hashed, so a lost key is a rotated key, not a recovered one.

Only an administrator can create or revoke a key. Public API access itself needs Starter or Professional.

## Choose scopes

Every key starts with the read scopes. Write scopes are opt-in, so a key minted to read feedback cannot delete posts, rewrite tags or announce a release.

| Group | Scopes |
| --- | --- |
| Boards | \`boards.read\`, \`boards.write\` |
| Posts | \`posts.read\`, \`posts.create\`, \`posts.update\`, \`posts.delete\`, \`posts.merge\` |
| Comments | \`comments.read\`, \`comments.write\` |
| Votes | \`votes.read\`, \`votes.write\` |
| Tags | \`tags.read\`, \`tags.write\` |
| Changelog | \`changelog.read\`, \`changelog.write\` |
| CRM | \`companies.*\`, \`end_users.*\` |
| Audit log | \`audit_log.read\` |

Two groups are opt-in as a whole, reads included: companies and end users are records about your own customers rather than your content, and minting a key should not hand them over by default.

\`posts.merge\` is separate from \`posts.update\` because a merge is more than an edit: it archives one post and moves another's comments and votes.

## Missing scopes

A call outside the key's scopes answers \`403\` with the missing scope named in the body. The list endpoint itself reports what the key holds, so a client can check before it tries.

## Rotation

Keys are never widened. If a key needs more than it was issued with, create a new one, move the caller over, then revoke the old one — the two coexist until you do.

Revoking is immediate: the next request with that key answers \`401\`.

## What to keep secret

A key acts as the workspace within its scopes. Keep it in server-side configuration, never in a browser bundle or a repository, and never in the embeddable widget. Customer-facing surfaces use the widget's own credentials instead — see [Embed the widget](/help/articles/embed-the-widget).`,
      },
      {
        slug: "import-and-export",
        title: "Import and export posts",
        publishedDaysAgo: 26,
        content: `Posts move in and out as CSV, from **Settings → Data → Imports & exports**. Both directions need the manager permissions for importing and exporting, and both are capped at 20,000 rows and a 10 MB file.

## Export

Choose a board, or every board, and download. The file is UTF-8 with a byte-order mark and CRLF line endings, so Excel reads non-ASCII titles correctly on a double-click.

Free-text cells that a spreadsheet would treat as a formula are written with a leading apostrophe and quoted. A cell is never evaluated on export, and a round trip through export and import is unchanged.

## Import

1. Download the template — the page offers the header as a file, so a first import does not start from a blank page.
2. Fill it in. The header is the contract:

| Column | Meaning |
| --- | --- |
| \`title\` | Required. The post's title. |
| \`description\` | The body, as Markdown. |
| \`status\` | A status display name, matched case- and separator-insensitively. An unknown value imports with the default open status and a row warning. |
| \`board\` | The destination board's name. A board you do not have is created, and the preview says so. An empty cell lands on the oldest board. |
| \`author_email\` | Resolves or creates a customer by email. A malformed address means the post imports without an author. |
| \`votes\` | A vote count, applied as the post's starting tally. |
| \`created_at\` | The original submission date, so an imported backlog is not all dated today. |

3. Upload. Nothing is written yet.
4. Review the preview: how many rows are ready, how many carry a substitution, how many failed and why.
5. Confirm. The import runs as a background job, one transaction per row, and can be cancelled between rows. Posts created before a cancel are kept.

## What import does not do

Import is **create-only**. It never matches or updates an existing post — not by title, not by slug — so exporting a board and importing the file back creates duplicates. Re-uploading identical bytes warns on the preview (the job keeps the file's SHA-256) and is still allowed.

## Repairing a failed import

The job's review page lists every row in file order and filters by failed, warned, ready, imported or destination board. A warned row shows exactly what will be substituted; a failed row shows its field-scoped reason.

The page can download the failed and warned rows as a small repair sheet: fix those in the spreadsheet, upload again, and only the broken rows are imported. The second import is create-only, so the rows that already succeeded are not duplicated by this — do not include them in the repair sheet.

Jobs and their reports are kept for 30 days, and the review page shows when the job will be deleted.

## Other tools

Starter and Professional can pull from a supported feedback tool instead of a file, using a credential you supply once. The parsed rows, the preview, the confirmation and the row report are the same as for an upload — the only difference is where the rows came from.`,
      },
      {
        slug: "embed-the-widget",
        title: "Embed the widget",
        publishedDaysAgo: 20,
        content: `The widget puts three surfaces inside your own application, so a customer never has to open a new tab: the feedback board, your product updates, and your help center.

## Install

1. Open **Settings → Widget**.
2. Turn on the modules to ship, and choose how the widget opens — one module, or a hub with a tab bar.
3. Copy the generated snippet into your page, before the closing \`</body>\`.

\`\`\`html
<script
  async
  src="https://unpkg.com/@feeblo/sdk"
  data-feeblo-organization-id="org_..."
  data-feeblo-base-url="https://app.example.com"
  data-feeblo-mode="hub"
  data-feeblo-modules="feedback,updates,help"
  data-feeblo-theme="auto"
></script>
\`\`\`

| Attribute | Meaning |
| --- | --- |
| \`data-feeblo-organization-id\` | Which workspace the widget reads. Required. |
| \`data-feeblo-base-url\` | The origin serving the portal. Required. |
| \`data-feeblo-mode\` | \`hub\` for several surfaces behind one launcher, or \`feedback\`, \`updates\` or \`help\` for a single one. |
| \`data-feeblo-modules\` | Which surfaces the hub exposes, in tab order. Only with \`hub\`. |
| \`data-feeblo-theme\` | \`light\`, \`dark\` or \`auto\`. |

## What each module shows

| Module | Content |
| --- | --- |
| \`feedback\` | Your boards and their posts: browse, vote, search for a duplicate, submit. |
| \`updates\` | Your published changelog entries, newest first. |
| \`help\` | Your help center: each section, and the articles in it. |

Two of the three depend on something you publish, and the widget reads that live rather than trusting the snippet:

- A **private board** is not offered in the widget, and a closed one refuses its posts there.
- The **help tab disappears** until the workspace has published documentation *and* left the help center visible, and it comes back on the next open once both are true — turning the help center off in **Settings → Help center privacy** removes it without a snippet change. An archived article still appears, marked out of date, the same as on the portal.

A hub with only one *available* surface renders that surface and no tab bar — a bar with one item is chrome for nothing.

## Identify the signed-in customer

By default the widget is anonymous — a customer can read and vote as a visitor. To attribute their votes to their real account, turn on widget SSO: **Settings → Widget → Single sign-on**.

1. Generate a signing secret. An administrator does this; it is never created automatically.
2. Mint a short-lived token on your server with that secret, carrying the customer's id and email.
3. Pass the token to the widget.

Keep the signing secret server-side. Never ship it to the browser, and prefer a fragment over a query string when you pass the token in a link — a query string leaks into logs, history and the \`Referer\` header, and a token in a URL stays replayable until it expires.

The widget attaches a token only to links on the embedding page's own origin, its subdomains, the configured base URL and any origins you list as allowed. Anything else is refused, so an injected link cannot exfiltrate it.

Widget SSO is available on Starter and Professional.

## What the widget is for

It is the lowest-friction surface you have: the customer is already using the product, so "say what you want" costs one click. Put the launcher where a customer would look for help — beside a support link, in a settings menu — rather than over the content they are reading.`,
      },
    ],
  },
  {
    slug: "workspace-settings",
    name: "Workspace settings",
    description:
      "Branding, domains, notifications and the rest of the workspace.",
    icon: "adjustments",
    articles: [
      {
        slug: "branding-and-domains",
        title: "Branding and domains",
        publishedDaysAgo: 14,
        content: `The portal carries your workspace's name, icon and colour. Two more settings decide whether customers see it on your domain and whether it advertises what runs it.

## Branding

Open **Settings → Customize**.

| Setting | Effect |
| --- | --- |
| **Workspace name** | Sidebar, portal header, email sender name, page titles. |
| **Logo** | The portal header and the widget launcher. |
| **Accent colour** | Buttons, links and the selected state on the portal. |
| **Theme** | Whether the portal follows the visitor's system theme or is pinned. |

A logo is uploaded once and reused on the portal and in the widget; there is no separate asset per surface.

## Custom domain

A workspace has a free subdomain:

\`\`\`
yourworkspace.feeblo.app
\`\`\`

A custom domain — \`feedback.yourcompany.com\` — can serve the same portal. Add it in **Settings → Workspace**, then point a CNAME at the address shown. The page reports whether DNS and the certificate are ready, and the portal does not switch over until they are.

Two things to check before you move traffic:

- The subdomain keeps working, so links already posted elsewhere do not break.
- A custom domain needs its own certificate. The first one takes a few minutes to issue.

## Hiding the "Powered by" link

Every portal shows a small link back to the platform unless the plan allows removing it. That is Starter and Professional, from **Settings → Customize**.

## Search engines

**Settings → Workspace** has an index switch. Turn it off for a portal that is only for existing customers — for example one behind a login, or a launch you are not announcing yet. The portal then answers \`noindex\` and stops advertising its sitemap, while the pages keep working for people who have the link.

## Which surfaces are public

Each surface switches separately:

| Surface | Where | Effect of hiding |
| --- | --- | --- |
| Feedback board | Settings → Boards | The board's posts stop being readable on the portal. |
| Roadmap | Settings → Roadmap | The roadmap tab disappears and its path 404s. |
| Changelog | Settings → Changelog privacy | The tab, the RSS feed and the widget tab all go. |
| Help center | Settings → Help center privacy | The tab and article pages 404. |

Hiding a surface is a publishing decision, not a permissions one: you can always flip it back, and the content keeps its addresses for your team.`,
      },
      {
        slug: "notifications",
        title: "Notifications",
        publishedDaysAgo: 10,
        content: `Notifications reach a member through two channels that behave differently on purpose: an in-app inbox that is per event, and email that is batched.

## In-app

The bell in the dashboard is a durable per-member inbox. It records:

| Event | Who is notified |
| --- | --- |
| A comment on a post | The post's author and its subscribers |
| A status change on a post | The same |
| A post merged into another | The creators, subscribers and upvoters of both posts |
| A merge reverted | The same |
| A changelog entry published | Members subscribed to the changelog |

The person who caused the event is never notified about their own action, and duplicate recipients are reduced to one row. A read notification stays in the inbox; clearing it is manual.

## Email

Submission email is not one message per post. Every submission joins the workspace's pending window, and the window sends five minutes after its last post, at most once an hour per workspace. That is why the inbox shows a new post before the email arrives.

A workspace owner or administrator opts in or out of it in **Settings → Notifications** — per workspace and per account, so the same person can receive one workspace's submissions and not another's.

## Customer email

Customers get their own emails, and they are separate from anything a member receives:

| Mail | Trigger |
| --- | --- |
| Post submitted | The customer's confirmation, if they asked for one |
| Status changed | Sent to the post's author and everyone subscribed to it |
| Changelog published | Sent to the changelog's subscribers |

Subscriber email — the changelog mailing — is on Starter and Professional. Status-change mail to a post's own voters is on every plan, because it is the notification that closes the loop the board opened.

## Turning things off

A specific post stops notifying a customer when they unsubscribe from it, from the link in any of its emails. That is their decision, not a workspace setting: nothing an administrator changes re-subscribes somebody.

A member who leaves the workspace keeps any email they received before the removal and stops receiving new ones with the workspace's mail.`,
      },
    ],
  },
];
