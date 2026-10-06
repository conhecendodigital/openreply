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
        "Google, for Sign in with Google.",
        "Meta, through the Instagram API and, if the owner turns it on, the Conversions API.",
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
      heading: "Authorized use",
      paragraphs: [
        "Only with Instagram professional accounts you own or are authorized to manage. You are responsible for the campaigns, keywords, links and messages you configure.",
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
