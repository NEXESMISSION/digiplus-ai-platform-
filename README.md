# DigiPlus AI

Chat assistants for Tunisian businesses, opened from a link — no Messenger, Instagram or WhatsApp.
The client writes in Derja or French; the assistant answers with the business's real prices, takes
contact details, bookings and orders, and the owner reads every conversation in an inbox.

Live: https://digiplus.lol

## Pages

| Path | What |
|---|---|
| `/` | Landing page: demos, how it works, pricing |
| `/chat/<assistant>` | The chat. `clim-express`, `yasmine-photo` and `patisserie-nour` are demos; `digiplus` answers about DigiPlus AI (`?plan=` sends the plan picked on the pricing) |
| `/admin` | Owner inbox, with an email sign-in link |
| `/privacy` | Privacy page |

## How an answer is made

- `lib/bots.js` — the assistants: name, colors, welcome, starters, profile, and which details, bookings or catalogue each one takes.
- `brain/<assistant>.md` — what each assistant knows and how it behaves. `brain/voice.md` is the Tunisian voice they all share.
- `data/<assistant>.json` — a catalogue: products, sizes and prices. Photos are in `public/img/catalog/`.
- `lib/reply.js` — calls OpenAI with tools (`lib/tools.js`: save details, show products, save an order, book a time), then checks the answer before it is sent:
  - `lib/guard.js` — only prices that exist in the brain, the catalogue or a tool result;
  - `lib/derja.js` — no words that aren't Tunisian.
- `api/chat.js` and `api/admin.js` are the Vercel functions; `lib/store.js` talks to Supabase.

## Setup

1. **Supabase**: run `supabase/schema.sql` (SQL editor, or `npm run sql -- supabase/schema.sql`).
   In Authentication → URL Configuration, set the Site URL to the site and add `https://<site>/**`
   (and `http://localhost:3000/**`) to the Redirect URLs, so the inbox sign-in link works.
2. **Environment**: copy `.env.example` to `.env`. On Vercel, add the same variables except
   `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN`.
3. `npm install`

| Variable | What |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `OPENAI_API_KEY` | OpenAI |
| `SUPER_ADMIN_EMAILS` | emails allowed into `/admin`, comma-separated |
| `CHAT_MODEL`, `CHAT_REASONING` | optional — default `gpt-5.4`, reasoning `none` |
| `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN` | this machine only, for `npm run sql` |

## Scripts

| Command | What |
|---|---|
| `npm run dev` | the site on http://localhost:3000 (the inbox skips the sign-in locally) |
| `npm run exam` | plays the conversations in `exams/` with the real AI and checks every answer. Run it after changing a brain file (uses OpenAI credits) |
| `npm run sql -- <file.sql>` | runs SQL on the Supabase database |
| `npm run catalog-images -- <assistant>` | prints the prompts for the missing product photos, to paste in ChatGPT |

## Pictures

No picture in this project is ever generated with the paid API: photos, logos and slide images are made in
**ChatGPT in the browser** (already included in the account) and saved in `public/img/`. `lib/no-image-api.js`
enforces it — it is loaded by every tool and by `.npmrc`, and any call to an image or video endpoint throws.

## Deploy

`vercel deploy --prod` — project `digiplus-ai-platform`, region `dub1`.
`.vercelignore` keeps `tools/`, `exams/` and `supabase/` out of the deployment.
