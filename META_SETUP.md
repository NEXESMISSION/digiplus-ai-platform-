# WhatsApp & Messenger setup — Digiplus Chatbot

No passwords or tokens in this file. Secrets live only in `.env`.

## Meta app
| What | Value |
|---|---|
| App name | Digiplus Chatbot |
| App ID | 1492691982693937 |
| Business portfolio | DigiPlus — ID 1237776958360981 (NOT verified yet) |
| Contact email | the Gmail you use for Facebook |
| Dashboard | https://developers.facebook.com/apps/1492691982693937/ |
| Use cases added | WhatsApp, Messenger |

## WhatsApp (test)
| What | Value |
|---|---|
| Test phone number | +1 (555) 181-9042 |
| Phone Number ID | 1389471517573000 |
| WhatsApp Business Account ID | 1720140252373745 |
| Graph API version shown by Meta | v25.0 |
| Limit | test number can message max 5 recipient numbers |

## `.env` status (updated 2026-09-13)
- [x] `WHATSAPP_TOKEN` — TEMPORARY, expires 2026-09-13 22:00 UTC. Replace with a permanent System User token
      (business.facebook.com → Settings → Users → System users).
- [x] `META_VERIFY_TOKEN` — generated; paste the same value in Meta when setting the webhook.
- [x] `META_APP_SECRET` — set and verified against the app.
- [ ] `MESSENGER_PAGE_TOKEN` — connect a Facebook Page in the Messenger use case.
- [x] `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — schema applied to project bjlxcrtqtonkaciykgxd
- [x] `OPENAI_API_KEY` — bot uses GPT-5 mini (Gemini off for now)

## Done
- WhatsApp Business Account 1720140252373745 is subscribed to the Digiplus Chatbot app (`subscribed_apps`).
- Webhook endpoint tested: verify handshake OK, unsigned requests rejected.
- Local testing tunnel (changes every time ngrok restarts): `https://igloo-easter-impulsive.ngrok-free.dev/api/webhooks/meta`

## To do, in order
1. Add your own WhatsApp number as a test recipient (Step 1. Try it out → To) and send the test message.
2. Put `META_APP_SECRET` in `.env`, restart the server.
3. WhatsApp → Configuration → Webhook (for local testing, use the ngrok URL above):
   - Callback URL: `https://YOUR-APP.vercel.app/api/webhooks/meta`
   - Verify token: value of `META_VERIFY_TOKEN`
   - Subscribe to: `messages`
4. Deploy to Vercel, copy every `.env` value into Vercel → Settings → Environment Variables,
   then change the Callback URL to the Vercel one.
6. Send a WhatsApp message to the test number → the bot should answer.
7. Messenger: connect Page, generate Page token, same webhook URL, subscribe `messages` + `messaging_postbacks`.
8. Before real clients: permanent token, add your real number (Step 2), business verification (Step 3),
   App Review for Messenger (`pages_messaging`).
