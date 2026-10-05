import type { SeoPageConfig } from "@/components/seo-page-shell";

/**
 * Páginas públicas de SEO (2026-10-04). O texto fica em inglês aqui (é a
 * chave) e a tradução em português mora em lib/i18n/pt-public.ts. Só fatos
 * que o app faz hoje: nada de número, cliente ou depoimento inventado. Ao
 * citar concorrente, comparação neutra e sem prometer o que o app não faz.
 */

const templateLinks = [
  { label: "Product link template", href: "/templates/dtc-product-link" },
  { label: "Real estate lead form template", href: "/templates/real-estate-lead-form" },
  { label: "Fitness plan template", href: "/templates/fitness-plan" },
  { label: "See every template", href: "/templates" },
];

export const manychatAlternativePage: SeoPageConfig = {
  metaTitle: "ManyChat alternative for Instagram comment to DM - Lead Engine",
  metaDescription:
    "Lead Engine is an open source tool focused on Instagram: comment to DM, Direct, contacts and reports through the official Meta API. See how it compares with ManyChat.",
  eyebrow: "ManyChat alternative",
  title: "An Instagram focused alternative to ManyChat",
  description:
    "ManyChat is a conversation automation platform that serves several channels. Lead Engine does one thing: Instagram, through the official Meta API, with comment to DM, Direct, contacts and campaign reports.",
  primaryCta: "Sign in to Lead Engine",
  checklistTitle: "What you get",
  bullets: [
    "Comment to DM campaigns for a post, a reel or any post.",
    "Official Meta API, with no shared password and no browser bot.",
    "Direct inbox with photos, videos and audio, plus a contacts CRM.",
    "Open source code under the MIT license, running on your own server.",
  ],
  sections: [
    {
      title: "Instagram only",
      body: "Lead Engine does not try to cover every channel. Everything in it is built around comments, the Direct and the contacts of your Instagram professional account.",
    },
    {
      title: "Proof for the client",
      body: "Each campaign can have a public read only report link with sends, skips, failures, clicks and keywords, so you can show what happened after the comment.",
    },
    {
      title: "Inside Meta's rules",
      body: "Comments arrive by webhook, go into a queue, are checked against duplicates and sending limits, and the reply goes out through the official API.",
    },
  ],
  comparisonTitle: "Lead Engine and ManyChat side by side",
  otherLabel: "ManyChat",
  comparisons: [
    {
      label: "Channels",
      ours: "Instagram only, through the official Meta API.",
      other: "Several channels, such as Instagram, Messenger and WhatsApp.",
    },
    {
      label: "Where it runs",
      ours: "Open source code (MIT) that you run on your own server.",
      other: "Hosted service run by the company itself.",
    },
    {
      label: "Comment to DM",
      ours: "Campaign by post or reel, with keyword, public reply and tracked link.",
      other: "Also offers Instagram comment to DM automation.",
    },
    {
      label: "Client report",
      ours: "Public read only link per campaign, without your brand on it.",
      other: "Check the current features and plans on the ManyChat website.",
    },
  ],
  templateLinks,
  faqs: [
    {
      title: "Does Lead Engine fully replace ManyChat?",
      body: "It depends on what you use. If you need channels other than Instagram, Lead Engine does not cover them. If your work is on Instagram, it has comment to DM, Direct, contacts, visual flows, moderation and broadcasts within 24 hours.",
    },
    {
      title: "Do I need to share my Instagram password?",
      body: "No. You connect your professional account through the official Meta login and can disconnect at any time.",
    },
    {
      title: "Is Lead Engine affiliated with Meta or ManyChat?",
      body: "No. Lead Engine uses the official Meta API and has no link with Meta, Instagram or ManyChat.",
    },
  ],
};

export const templatesSeoPage: SeoPageConfig = {
  metaTitle: "Instagram comment to DM templates - Lead Engine",
  metaDescription:
    "Comment to DM campaign templates for product links, free materials, price lists, events and creators. Each one comes with keywords, a message and a step by step.",
  eyebrow: "Comment to DM templates",
  title: "Comment to DM templates for Instagram",
  description:
    "Start from a ready example for product links, free materials, price lists, events and services. Each template comes with keywords, the DM message and a step by step.",
  primaryCta: "Sign in and create a campaign",
  checklistTitle: "In every template",
  bullets: [
    "Suggested keywords for the comment.",
    "A DM message you can edit before turning it on.",
    "A step by step to set up the campaign.",
    "The metrics worth following after it goes live.",
  ],
  sections: [
    {
      title: "Product links",
      body: "Use LINK, SHOP or BUY in the comment to send the product page, the collection or the launch kit.",
    },
    {
      title: "Free materials",
      body: "Use GUIDE, PLAN or START to deliver a free material and, after it, the next step of your offer.",
    },
    {
      title: "Local services",
      body: "Use PRICE, BOOK or MENU to send the price list, the booking link or the service menu.",
    },
  ],
  comparisonTitle: "Template campaign or replying by hand",
  otherLabel: "Replying by hand",
  comparisons: [
    {
      label: "Speed",
      ours: "Start from a ready example and adjust the text.",
      other: "Write the same reply every time someone comments.",
    },
    {
      label: "Tracking",
      ours: "Tracked links and keyword counts per campaign.",
      other: "Screenshots, memory and scattered links.",
    },
    {
      label: "Reuse",
      ours: "The same idea works on other posts, reels and accounts.",
      other: "Every campaign starts from zero.",
    },
  ],
  templateLinks,
  faqs: [
    {
      title: "Can I change the template text?",
      body: "Yes. The template is a starting point. You change the keywords, the DM message and the link before turning the campaign on.",
    },
    {
      title: "Do templates work on reels?",
      body: "Yes. A campaign can point to a post or a reel of the connected professional account.",
    },
  ],
};

export const agenciesSeoPage: SeoPageConfig = {
  metaTitle: "Instagram DM automation for agencies - Lead Engine",
  metaDescription:
    "Several Instagram accounts in one workspace, team roles, account filters and read only campaign reports to share with clients.",
  eyebrow: "For agencies",
  title: "Instagram DM automation for agencies that manage clients",
  description:
    "Connect your clients' Instagram accounts in one workspace, invite the team with the right role and share read only campaign reports.",
  primaryCta: "Sign in and set up the workspace",
  checklistTitle: "What helps agencies",
  bullets: [
    "Several Instagram professional accounts in one workspace.",
    "Filter campaigns, history and settings by account.",
    "Invite people as owner, admin or member.",
    "Share read only reports without opening the panel.",
  ],
  sections: [
    {
      title: "Each client separated",
      body: "The account filter keeps campaigns, history and reports of each brand apart, even with everything in the same workspace.",
    },
    {
      title: "Services you can repeat",
      body: "Use the templates to package free materials, product links, price lists and waitlists as a service you repeat for each client.",
    },
    {
      title: "Proof of work",
      body: "The report shows sends, skips, failures, clicks, click rate, top keywords and tracked links, without exposing the panel.",
    },
  ],
  comparisonTitle: "Agency routine with and without Lead Engine",
  otherLabel: "Without a dedicated tool",
  comparisons: [
    {
      label: "Client report",
      ours: "Public read only link per campaign, without your brand on it.",
      other: "Screenshots put together by hand every week.",
    },
    {
      label: "Team",
      ours: "Owner, admin and member roles, with an invitation link.",
      other: "One shared login for everyone.",
    },
    {
      label: "Accounts",
      ours: "Filter by account in campaigns, history, dashboard and settings.",
      other: "Work from different clients mixed together.",
    },
  ],
  templateLinks,
  faqs: [
    {
      title: "How many Instagram accounts can I connect?",
      body: "The open source version does not set a limit on accounts. Meta's own sending limits still apply to each account.",
    },
    {
      title: "Can the client see the report without signing in?",
      body: "Yes. The report link is public and read only. It hides the panel controls and the DM text.",
    },
  ],
};

export const commentLinkSeoPage: SeoPageConfig = {
  metaTitle: "Comment LINK automation for Instagram - Lead Engine",
  metaDescription:
    "Whoever comments LINK, SHOP, GUIDE or your keyword gets the DM with the right link, through the official Meta API, with tracked clicks.",
  eyebrow: "Comment LINK automation",
  title: "Comment LINK and get the link in the Direct",
  description:
    "Your follower comments LINK, SHOP, GUIDE or any keyword you choose and gets the DM with the right link, with tracked clicks.",
  primaryCta: "Sign in and create a campaign",
  checklistTitle: "How it works",
  bullets: [
    "Match the exact word or any word in the comment.",
    "The reply goes out from the comment, through the official Meta API.",
    "Tracked links show who clicked.",
    "Each comment is processed once and every send is logged: sent, skipped or failed.",
  ],
  sections: [
    {
      title: "For products",
      body: "Turn LINK comments into visits to the product page, the sales page, the waitlist or the checkout.",
    },
    {
      title: "For creators",
      body: "Send guides, free materials, course links and applications without watching the inbox all day.",
    },
    {
      title: "For busy moments",
      body: "When a reel takes off, the replies go into a queue and respect Meta's sending limits.",
    },
  ],
  comparisonTitle: "Automatic link or link pasted by hand",
  otherLabel: "Pasting by hand",
  comparisons: [
    {
      label: "Nobody left out",
      ours: "Every comment with the keyword gets the reply for that post or reel.",
      other: "When comments pile up, it is easy to miss someone.",
    },
    {
      label: "Tracking",
      ours: "Tracked links connect the DM to the click.",
      other: "A pasted link does not show results per campaign.",
    },
    {
      label: "Account safety",
      ours: "Official Meta API, with a queue that respects the limits.",
      other: "Browser bots and scraping can put the account at risk.",
    },
  ],
  templateLinks,
  faqs: [
    {
      title: "Can I use words other than LINK?",
      body: "Yes. Each campaign can have several keywords, like PRICE, SHOP, GUIDE, PLAN or a word of your own.",
    },
    {
      title: "Does it send a normal Instagram DM?",
      body: "It sends a private reply tied to the comment, through the official Meta API, using the comment ID. It arrives in the person's Direct.",
    },
  ],
};
