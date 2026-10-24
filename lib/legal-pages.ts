/**
 * Textos das páginas legais (06/10/2026, revisão do app pela Meta). Em inglês
 * (a chave); o português fica em lib/i18n/pt-public.ts. {company}, {cnpj},
 * {address}, {email}, {city}, {site}, {product} e {days} vêm de
 * lib/legal-info.ts.
 */
export type LegalSection = {
  heading: string;
  paragraphs: string[];
  /** Lista com marcadores depois dos parágrafos. */
  items?: string[];
};

export type LegalPage = {
  metaTitle: string;
  metaDescription: string;
  title: string;
  description: string;
  sections: LegalSection[];
};

export const privacyPage: LegalPage = {
  metaTitle: "Privacy Policy - Lead Engine",
  metaDescription:
    "How Lead Engine, a service of {company}, collects, uses, shares and deletes Instagram and account data.",
  title: "Privacy Policy",
  description: "How {product} collects, uses, shares and deletes data, and how you can use your rights.",
  sections: [
    {
      heading: "Who we are",
      paragraphs: [
        "{product} ({site}) is operated by {company}, CNPJ {cnpj}, {address}, {city}, Brazil. We are the controller of Lead Engine account data and the processor of the data our customers handle through the service. Contact: {email}.",
      ],
    },
    {
      heading: "What Lead Engine does",
      paragraphs: [
        "It helps creators and businesses with an Instagram professional account send a private reply to people who comment a keyword on the account's own posts, and read and answer those conversations in an Inbox. We only use Meta's official APIs. We never ask for Instagram passwords, never scrape Instagram and never use browser automation.",
      ],
    },
    {
      heading: "Data we collect",
      paragraphs: [],
      items: [
        "Lead Engine account: name, email, password (stored only as a hash), Google sign-in data and security settings (two-factor authentication).",
        "Connected Instagram account, with the owner's permission: account ID, username, name, profile picture, follower count, list of posts and reels, post insights (reach, views, saves, shares) and the Instagram access token, stored encrypted with AES-256-GCM.",
        "People who interact with the connected account: their Instagram-scoped ID and username, public name and profile picture, comment text, messages exchanged with the connected account and their media, whether they follow the account (only when the owner turns this on) and clicks on tracked links.",
        "Service data: campaigns, keywords, delivery history, technical logs and diagnostics.",
      ],
    },
    {
      heading: "TikTok",
      paragraphs: [
        "If the owner connects a TikTok account, {product} uses TikTok's official Login Kit and Content Posting API only to publish or schedule the videos the owner chooses. We do not read TikTok comments or direct messages, and we never ask for the TikTok password.",
      ],
      items: [
        "From TikTok, with the owner's permission: the TikTok open ID, display name and profile picture, and the access token and refresh token, stored encrypted with AES-256-GCM.",
        "What the owner sends us to publish: the video file, the caption, the privacy, comment, duet and stitch choices, the commercial content declaration, the chosen date and time, and the status of each publication.",
        "We use this data only to publish or schedule what the owner confirmed. We do not sell it, do not use it for advertising and do not use it to train AI models. If an AI assistant is connected through our MCP, it can only create drafts: scheduling and publishing are always done by a person on the screen.",
        "To revoke access, open TikTok, go to Settings, then Security and permissions, then Apps, and remove {product}. You can also click Disconnect on the TikTok account inside {product}. Either way, the TikTok tokens are deleted and nothing is published anymore.",
        "We keep TikTok data while the account is connected. Videos and captions are kept until the owner deletes them or asks for deletion. See {site}/data-deletion for the step by step.",
      ],
    },
    {
      heading: "YouTube and Google APIs",
      paragraphs: [
        "If the owner connects a YouTube channel, {product} uses Google's OAuth and the YouTube API Services only to upload and publish the videos the owner chooses, and to show the connected channel. We never ask for the Google password.",
        "Lead Engine's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.",
      ],
      items: [
        "From Google, with the owner's permission: the YouTube channel ID, title and picture, the granted permissions, and the access token and refresh token, stored encrypted with AES-256-GCM.",
        "What the owner sends us to publish: the video file, the title, description, visibility, the made for kids answer, the AI content declaration, the chosen date and time, and the status of each upload.",
        "We use YouTube data only to publish what the owner confirmed and to show the channel inside {product}. We do not sell it, do not use it for advertising, do not transfer it to others except to run the service or when the law requires it, and do not use it to train AI models.",
        "To revoke access, open myaccount.google.com/permissions, pick {product} and remove access. You can also click Disconnect on the YouTube channel in {product}. Either way, the YouTube tokens are deleted and nothing is published anymore.",
        "We keep YouTube data while the channel is connected. Videos and descriptions are kept until the owner deletes them or asks for deletion. See {site}/data-deletion for the step by step.",
      ],
    },
    {
      heading: "Publishing to Instagram and Facebook",
      paragraphs: [
        "If the owner turns on publishing, {product} can post Reels on the connected Instagram professional account and videos on the connected Facebook Page, through Meta's official APIs, only what the owner confirmed on the screen. The same account tokens are used, stored encrypted, and disconnecting the channel deletes them.",
      ],
    },
    {
      heading: "How we use data",
      paragraphs: [
        "To sign you in, connect Instagram, find the keyword in comments, send the private and public replies the owner configured, show conversations in the Inbox, build the owner's contact list and reports, avoid duplicate sends, respect Meta's limits, fix errors and protect the service. We do not sell data. We do not use Instagram data for our own advertising or to train AI models.",
      ],
    },
    {
      heading: "Artificial intelligence",
      paragraphs: [
        "Some features use AI providers (such as Anthropic and OpenAI) to suggest replies. A suggestion is only sent after a person approves it. If the owner connects their own AI assistant through our API or MCP, the conversation data they request is shared with that assistant, at the owner's direction.",
      ],
    },
    {
      heading: "Who we share data with",
      paragraphs: [
        "Only with the providers that run the service, and when the law requires it:",
      ],
      items: [
        "Our own server, a VPS rented from Hostinger and managed with Dokploy, where the PostgreSQL database, the Redis queue and the media storage also run.",
        "Resend, to send sign-in emails.",
        "Google, for Sign in with Google and, through the YouTube API Services, only to publish what the owner confirmed.",
        "Meta, through the Instagram API and, if the owner turns it on, the Conversions API.",
        "TikTok, through the Login Kit and the Content Posting API, only to publish what the owner confirmed.",
        "Hotmart, to confirm purchases.",
        "The AI providers above, only for the features that use AI.",
      ],
    },
    {
      heading: "How long we keep data",
      paragraphs: [
        "While the customer account is active. When the owner disconnects Instagram, the access token is deleted right away and all sending stops. When the owner deletes the channel, removes the app on Instagram or asks for deletion, we delete that account's campaigns, contacts, conversations, media, logs and history within {days} days, except what the law requires us to keep.",
      ],
    },
    {
      heading: "Your rights (LGPD)",
      paragraphs: [
        "You can ask for confirmation, access, correction, portability and deletion of your data, information about who we share it with, and you can withdraw your consent. Write to {email}. If you only commented on or messaged one of our customers, you can also talk to that account directly.",
      ],
    },
    {
      heading: "Data deletion",
      paragraphs: ["See the step by step at {site}/data-deletion."],
    },
    {
      heading: "Security",
      paragraphs: [
        "Instagram access tokens are encrypted, Meta webhooks have their signature checked, and access is protected by a strong password, sign-in link and two-factor authentication.",
      ],
    },
    {
      heading: "Contact",
      paragraphs: ["{company}, CNPJ {cnpj}, {address}, {city}, Brazil. Email: {email}."],
    },
  ],
};

export const termsPage: LegalPage = {
  metaTitle: "Terms of Service - Lead Engine",
  metaDescription: "Terms for using Lead Engine, a service of {company}.",
  title: "Terms of Service",
  description: "The rules for using {product}. By using the service you agree to these terms.",
  sections: [
    {
      heading: "Provider",
      paragraphs: [
        "{product} is provided by {company}, CNPJ {cnpj}, {address}, {city}, Brazil. Contact: {email}.",
      ],
    },
    {
      heading: "The service",
      paragraphs: [
        "Software that sends private replies to people who comment keywords on your Instagram professional account's posts, with an Inbox, contacts and reports, through Meta's official APIs.",
      ],
    },
    {
      heading: "TikTok publishing",
      paragraphs: [
        "If you connect a TikTok account, you can upload videos and publish or schedule them from {product}. The use of TikTok stays subject to TikTok's Terms of Service, Community Guidelines, Branded Content Policy and Music Usage Confirmation, and you agree to follow them.",
        "You are responsible for the videos, captions and music you publish, and for declaring commercial content (your own brand or a paid partnership) when it applies. {product} only publishes what you confirmed on the screen, with the privacy and interaction options you chose. We do not offer a reply to TikTok comments or direct messages.",
        "Until TikTok approves our app for public posting, videos may be published only with the visibility Only me. This is a TikTok rule and it can change when the approval comes.",
      ],
    },
    {
      heading: "YouTube, Instagram and Facebook publishing",
      paragraphs: [
        "If you connect a YouTube channel, an Instagram professional account or a Facebook Page, you can upload videos and publish or schedule them from {product}. Each network stays subject to its own rules: the YouTube Terms of Service and Community Guidelines (and the Google Privacy Policy), and Meta's terms and policies for Instagram and Facebook. You agree to follow them.",
        "You are responsible for the videos, titles and descriptions you publish, for the answer about content made for kids, and for saying when a video has realistic scenes made or changed with AI. {product} only publishes what you confirmed on the screen.",
        "While the Google app is not verified, YouTube may keep every upload as Private. This is a Google rule and it changes when the verification comes.",
      ],
    },
    {
      heading: "Authorized use",
      paragraphs: [
        "Only with Instagram professional accounts, Facebook Pages, TikTok accounts and YouTube channels you own or are authorized to manage. You are responsible for the campaigns, keywords, links, messages, videos and captions you configure.",
      ],
    },
    {
      heading: "Platform rules",
      paragraphs: [
        "You agree to follow the Meta Platform Terms, Instagram's policies, the Brazilian data protection law (LGPD) and anti-spam laws. We may limit, pause or turn off campaigns that create a risk of abuse, spam, security problems or a block by Meta.",
      ],
    },
    {
      heading: "What is not allowed",
      paragraphs: [
        "Spam, illegal content, fraud, or trying to message people who did not interact with your account.",
      ],
    },
    {
      heading: "Availability",
      paragraphs: [
        "The service depends on Meta and other providers. We work to keep it running, but we do not guarantee it will always be available without interruption.",
      ],
    },
    {
      heading: "Cancellation",
      paragraphs: [
        "You can disconnect Instagram and ask for your data to be deleted at any time (see {site}/data-deletion). We may close accounts that break these terms.",
      ],
    },
    {
      heading: "Liability",
      paragraphs: [
        "We are not responsible for blocks or changes made by Meta, or for the content you send.",
      ],
    },
    {
      heading: "Law and courts",
      paragraphs: ["Brazilian law applies. Courts of {city}, Brazil."],
    },
  ],
};

export const dataDeletionPage: LegalPage = {
  metaTitle: "Data Deletion - Lead Engine",
  metaDescription:
    "How to delete your Lead Engine data: in the app with Delete for real, or by removing the app on Instagram.",
  title: "Data Deletion",
  description: "There are two ways to delete the data of an Instagram account from {product}. Both are below.",
  sections: [
    {
      heading: "Way 1: in the app (Delete for real)",
      paragraphs: ["If you are a Lead Engine customer:"],
      items: [
        "Sign in, open Channels and click Disconnect. The Instagram access token is deleted right away, webhooks stop and no more messages are sent. Disconnecting alone keeps your campaigns, contacts and conversations, so you can connect again later.",
        "To delete everything of that account (campaigns, contacts, conversations, media, logs, follower history), still on Channels, use Delete for real (disconnect first) and type the @ to confirm. This cannot be undone. Only the workspace owner can do it.",
        "To delete your whole Lead Engine account, email {email} from the address you use to sign in.",
      ],
    },
    {
      heading: "Way 2: on Instagram (remove the app)",
      paragraphs: [
        "On Instagram, open Settings, then Apps and websites, and remove Lead Engine. Meta tells us right away: first the account is disconnected and its token is deleted, and when Meta sends the data deletion request we delete all the data of that account automatically.",
        "Meta shows you a confirmation code. You can check the status of the request at {site}/data-deletion/status with that code, or type it below.",
      ],
    },
    {
      heading: "TikTok data",
      paragraphs: [
        "If you connected a TikTok account to {product}:",
      ],
      items: [
        "Sign in, open the TikTok account in {product} and click Disconnect. The TikTok access and refresh tokens and the connection are deleted right away, and nothing is published anymore. You can also remove {product} on TikTok, in Settings, Security and permissions, Apps.",
        "To also delete the videos, captions, drafts and scheduled posts of that account, email {email} from the address you use to sign in. We delete them within {days} days.",
      ],
    },
    {
      heading: "YouTube data",
      paragraphs: [
        "If you connected a YouTube channel to {product}:",
      ],
      items: [
        "Sign in, open the YouTube channel in {product} and click Disconnect. The YouTube access and refresh tokens and the connection are deleted right away, and nothing is published anymore. You can also remove {product} at myaccount.google.com/permissions.",
        "To also delete the videos, titles, descriptions, drafts and scheduled posts of that channel, email {email} from the address you use to sign in. We delete them within {days} days.",
      ],
    },
    {
      heading: "If you only commented or talked to an account that uses Lead Engine",
      paragraphs: [
        "Email {email} with your Instagram username and the account you talked to. We delete your data within {days} days.",
      ],
    },
    {
      heading: "Verification",
      paragraphs: [
        "We may ask you to confirm that you control the email or the account before deleting. We keep only what the law requires. Controller: {company}, {email}.",
      ],
    },
  ],
};

export const LEGAL_PAGES = { privacyPage, termsPage, dataDeletionPage };
