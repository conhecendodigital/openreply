# Meta App Review notes

You only need App Review if you want people who are not testers on your app to connect their own Instagram accounts. If you run OpenReply for your own accounts, skip this. See the "Letting other people use your instance" section of [docs/setup.md](docs/setup.md).

OpenReply uses the official Instagram API to send a private reply to someone who comments on a connected professional account's post or reel.

## Permissions to request

- `instagram_business_basic`
- `instagram_business_manage_comments`
- `instagram_business_manage_messages`
- `instagram_business_manage_insights` (requested by the OAuth today, used by Overview and Reports; the screens work without it)

## Permission justifications

Paste these into the App Review request, adjusted to your wording.

`instagram_business_basic`. We use this to identify the connected Instagram professional account after the user authorizes through Instagram business login, so we can associate the account with their workspace and show which account each automation belongs to.

`instagram_business_manage_comments`. When a follower comments a keyword the account owner configured on the owner's own post or reel, we receive the comment through the comments webhook and, if the owner enabled it, post a public reply under that comment. We only act on comments on the connecting account's own media.

`instagram_business_manage_messages`. After a follower comments a configured keyword, we send that follower a one-time private reply with content the account owner set up, typically a link or answer the follower asked for by commenting. This is the standard Instagram comment-to-DM flow. We send one reply per matching comment and respect Meta's rate limits.

## Screencast script

Record on your published app, real accounts, one take, about two to three minutes. Narrate each step.

1. Sign in with an email magic link.
2. Go to Settings and click Connect Instagram. Show the consent screen with the permissions being granted.
3. Create a campaign on a recent post with keyword `LINK`, a DM message, and save.
4. On a second phone or account, comment `LINK` on that post.
5. Show the second account receiving the DM, and the public reply appearing under the comment.
6. Back in the app, show the DM Logs page with the SENT row.

Reviewers want to see the permission produce a real result for a real user. This flow does that directly.

## Deauthorize and data deletion callbacks

Both are POST routes that receive Meta's `signed_request` (form-urlencoded), check the HMAC-SHA256 signature with `INSTAGRAM_APP_SECRET` (falls back to `FACEBOOK_APP_SECRET`) in constant time, and reject any other algorithm with a 400. The `user_id` in the payload is the app-scoped id (the `id` of `/me`), stored in `InstagramAccount.appScopedId` on every connect; the professional account id (`instagramId`) is also accepted. If no account, or more than one, matches, nothing is changed or deleted.

| Panel field | URL |
|---|---|
| Deauthorize callback URL | `https://many.leadenginer.com/api/instagram/deauthorize` |
| Data deletion request URL | `https://many.leadenginer.com/api/instagram/data-deletion` |

Where to paste: App Dashboard > Instagram > API setup with Instagram login > step "Set up Instagram business login" > Business login settings. The deauthorize URL goes in "Deauthorize callback URL" and the deletion URL in "Data deletion request URL". (In Portuguese: Instagram > Configuração da API com login do Instagram > Configurações de login comercial > "URL de retorno de chamada para cancelar autorização" e "URL de solicitação de exclusão de dados".)

- Deauthorize: the account goes DISCONNECTED, its token is wiped and `webhookSubscribed` is false. Conversations, contacts and automations are kept (same rule as the Disconnect button).
- Data deletion: deletes everything of that account in one transaction (the same one as "Delete for real", `lib/channels/purge.ts`), including the raw `WebhookEvent` payloads and the account's operational events. Responds `{ "url": "https://many.leadenginer.com/data-deletion/status?code=<CODE>", "confirmation_code": "<CODE>" }`. The request is kept in `DataDeletionRequest`; the public status page shows only the status and dates.
- Accounts connected before 2026-10-06 have no `appScopedId` until they reconnect. A deletion request for one of them is recorded as NOT_FOUND (nothing deleted) and logged as a WARNING operational event to be handled by hand.

Test it with Meta's tool after deploying, on a test account, never on a production account.

## Compliance positioning

- The app never scrapes Instagram and never asks for a password.
- It only sends a reply when someone comments on the connected account's own content.
- Tokens are encrypted at rest with AES-256-GCM.
- Users can disconnect Instagram on the Channels page, delete everything with "Delete for real", or remove the app on Instagram (handled by the callbacks above).
- Public pages: https://many.leadenginer.com/privacy, /terms, /data-deletion and /meta-review. Company data (DESTRAVE ACADEMY LTDA, CNPJ, address, email) lives in `lib/legal-info.ts`.
- Per-account rate limiting and deduplication prevent spammy behavior.

## Business verification

Meta usually requires business verification before granting Advanced Access. It asks for a document proving a legal entity: a business registration or license, articles of incorporation, a business tax document, or a business bank statement. If you do not have a registered business, you cannot complete this step, and the practical path is to run OpenReply for your own accounts instead, which never needs review.
