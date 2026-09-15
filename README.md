# DigiPlus AI

A SaaS where businesses create AI sales assistants (bots) trained on their services and prices. Each bot gets a public chat link and a website widget; owners read AI summaries and lead scores of every conversation.

- **Website** `/` · **Sign up / log in** `/signup`, `/login` · **Dashboard** `/app` · **Super admin** `/super` · **Public chat** `/c/<bot-id>`
- **AI**: OpenAI GPT-5 mini (exact token cost stored for every reply and summary)
- **Stack**: Node/Express API (Vercel serverless) · Supabase (Postgres + Auth) · plain HTML/JS frontend
- **Payments**: dinars via D17 / bank transfer (approved in `/super`) and cards in USD via Dodo Payments

## Plans (edit in `src/plans.js`)

| | Free trial | Starter | Pro | Business |
|---|---|---|---|---|
| Price | 0 (7 days) | 39 DT / $15 per month | 99 DT / $35 per month | 199 DT / $69 per month |
| Bots | 1 | 1 | 3 | 10 |
| AI replies / month (shared by all bots) | 300 | 2,000 | 5,000 | 15,000 |
| Business data per bot | 30k chars | 30k chars | 100k chars | 300k chars |
| Channels | web, Messenger, Instagram | web, Messenger, Instagram | + WhatsApp | + WhatsApp |
| "Powered by DigiPlus AI" badge | yes | yes | no | no |

Add-ons: extra bot 19 DT / $7 per month · +1,000 replies 15 DT / $5.

Every new account starts on the 7-day trial (`plan = 'trial'`, `plan_expires_at` set at sign-up); the trial is never sold, so it is not shown on the pricing page. When the monthly allowance is used up the bot stops calling the AI and shows the owner's contact info. When the trial ends or a paid plan expires, the account gets the **No plan** limits: the dashboard, bots and data stay, but the allowance is 0, so the bots stop answering until a plan is paid.

## Setup

### 1. Supabase
1. SQL Editor → run [`supabase/schema.sql`](supabase/schema.sql).
   Database created before the Free plan was removed: also run [`supabase/migrate-plans.sql`](supabase/migrate-plans.sql) (adds Business, turns old free accounts into 7-day trials).
2. Upgrading from the single-bot version only: run [`supabase/migrate-legacy.sql`](supabase/migrate-legacy.sql) (moves the old bot into an account claimed by the owner email written at the top of the file).
3. **Authentication → URL configuration**: Site URL = your app URL; add `https://YOUR-APP/**` (and `http://localhost:3000/**`) to Redirect URLs.
4. **Authentication → Emails → SMTP**: add your own SMTP (Resend, Brevo…). Supabase's built-in mailer only sends a few emails per hour — not enough for real sign-ups.

### 2. Environment variables
Copy `.env.example` to `.env` (locally) or add them in Vercel → Settings → Environment Variables.

| Variable | What |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `OPENAI_API_KEY` | OpenAI key |
| `SUPER_ADMIN_EMAILS` | emails allowed into `/super` (comma-separated) |
| `APP_URL` | public URL, used in payment return links |
| `CRON_SECRET` | protects the daily summary job |
| `DODO_*` | optional — card payments (see below) |

### 3. Card payments with Dodo (optional)
1. In Dodo, create: subscription products **Starter** ($15/mo), **Pro** ($35/mo) and **Business** ($69/mo), an add-on **Extra bot** ($7/mo) attached to all three, and a one-time product **1,000 AI replies** ($5).
2. Put their IDs in `DODO_PRODUCT_STARTER`, `DODO_PRODUCT_PRO`, `DODO_PRODUCT_BUSINESS`, `DODO_ADDON_EXTRA_BOT`, `DODO_PRODUCT_REPLY_PACK`, plus `DODO_PAYMENTS_API_KEY`.
3. Webhook URL: `https://YOUR-APP/api/webhooks/dodo` → copy its secret into `DODO_PAYMENTS_WEBHOOK_KEY`.
4. `DODO_PAYMENTS_ENVIRONMENT` = `test_mode` while testing, `live_mode` in production.

Without Dodo keys the billing page only offers D17 / bank transfer.

### 4. Run locally
```bash
npm install
npm run dev
```
Open http://localhost:3000, sign up, then set the D17 number / RIB shown to customers in `/super` → Payment details.

### 5. Deploy on Vercel
Import the repo (framework preset **Other**), add the environment variables, deploy. `vercel.json` routes the pages and runs the daily summary cron.

## Messaging channels (WhatsApp, Messenger, Instagram)

Starter includes Messenger + Instagram, Pro adds WhatsApp. Each bot connects its own accounts in **Dashboard → Channels**:

| Way to connect | How | Works for |
|---|---|---|
| **Continue with Facebook** | Facebook Login for Business → choose Pages and linked Instagram accounts | Everyone once the Meta app passes App Review (before that: people with a role on the app) |
| **Connect WhatsApp** | WhatsApp Embedded Signup → the number is registered and subscribed automatically | Everyone once you are a Meta Tech Provider |
| **Connect manually** | Paste the Page / Instagram / phone number ID and an access token. Add the app secret when the token comes from the business's own Meta app — it then gets a private webhook URL + verify token | Works today for a business's own accounts |

What happens with a message: webhook signature check → duplicate deliveries ignored → quick bursts answered once → AI reply within the monthly allowance → sent back through the Graph API (read receipt + typing indicator first) → saved with its cost.

Inbox: every channel appears in Conversations (filter by channel). **Pause bot & take over** stops AI replies for one client and lets you answer from the dashboard (Meta allows free-form replies up to 24 hours after the client's last message). A reply typed in the Facebook Page inbox pauses the bot automatically. Website visitors see human replies live.

Setup for the platform owner (see **/super → Meta & channels**):
1. `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `ENCRYPTION_KEY` (64 hex characters; tokens are stored encrypted — never change it afterwards).
2. Run on https (deploy, or set `WEBHOOK_BASE_URL` to a tunnel) and click **Register webhooks** (Pages, Instagram, WhatsApp → `/api/webhooks/meta`).
3. Create two Facebook Login for Business configurations (Pages/Instagram, and WhatsApp Embedded Signup) and put their IDs in `META_LOGIN_CONFIG_ID` / `META_WHATSAPP_CONFIG_ID`.
4. To serve every business: business verification, App Review (pages_messaging, pages_manage_metadata, pages_show_list, instagram_basic, instagram_manage_messages, business_management, whatsapp_business_messaging, whatsapp_business_management), WhatsApp Tech Provider onboarding, app in Live mode. Privacy policy: `/privacy` · Terms: `/terms`.

## Project structure
```
api/index.js              Vercel entry (all /api/* routes)
src/app.js                Express app: mounts routes, webhook, cron, errors
src/routes/public.js      site config + visitor chat per bot
src/routes/dashboard.js   account, bots, settings, test chat, conversations
src/routes/billing.js     manual payments, Dodo checkout/portal, Dodo webhook
src/routes/super.js       super admin: accounts, revenue, AI cost, approvals
src/services/assistant.js AI replies with allowance + cost tracking, summaries
src/billing/dodo.js       Dodo Payments client and webhook handling
src/plans.js              plans, prices, limits
src/settings.js           bot settings validation and data-size limit
src/prompts.js            bot instructions and summary prompt
src/ai.js                 OpenAI client (returns tokens and cost)
src/routes/channels.js    channel connect flows, human takeover, Meta webhooks
src/routes/meta-admin.js  super admin: Meta config + webhook registration
src/services/channels.js  inbound messages, replies, echoes, connect helpers
src/meta/                 Graph API client, webhook parser, channel queries
src/lib/crypto.js         AES-256-GCM token encryption
src/db.js                 Supabase queries
src/auth.js               Supabase Auth token check, super admin
supabase/schema.sql       tables, RLS, functions (reply limits, usage, search)
public/                   index (landing), auth, app (dashboard), super, chat, widget, privacy, terms
```

## Security
- Row Level Security is on for every table with no public policies: only the server (service role key) reads data.
- Dashboard API calls carry the Supabase access token; every bot and conversation is checked against the caller's account.
- Visitors can only read their own conversation (random token stored in their browser).
- Reply limits are enforced atomically in Postgres; Dodo webhooks are signature-verified and de-duplicated.
