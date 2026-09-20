# Deploying to Vercel

## Project settings

Import the GitHub repo at Vercel and leave the defaults alone. Next.js is detected automatically.

| Setting | Value |
| --- | --- |
| Framework Preset | Next.js (auto-detected) |
| Root Directory | leave blank |
| Build Command | leave default (`next build`) |
| Output Directory | leave default (`.next`) |
| Install Command | leave default (`npm install`) |
| Node Version | 20.x or later |

There is nothing custom to type. `next build` is correct as-is, and `npm run seed` must **not** run
on Vercel — seed from your own machine against the same Atlas cluster.

## Environment variables

Add these in **Settings → Environment Variables**, ticking Production, Preview and Development.

### Required

| Name | Value |
| --- | --- |
| `MONGODB_URI` | Your Atlas connection string, with the real password substituted for `<db_password>` |
| `MONGODB_DB` | `reloop` |
| `SESSION_SECRET` | A **new** random value, at least 32 characters. Do not reuse the local one. |
| `CRON_SECRET` | Any long random string. Vercel sends it as `Authorization: Bearer …` to the cron route, and the route refuses the request without it. |
| `DEMO_MODE` | `true` |
| `ALLOW_REAL_OUTREACH` | `false` |

Generate the two secrets:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### Recommended

| Name | Value |
| --- | --- |
| `OSRM_BASE_URL` | `https://router.project-osrm.org` |
| `NEXT_PUBLIC_MAP_STYLE_URL` | `https://tiles.openfreemap.org/styles/liberty` |

Both have the same values as defaults in code, so the app works if you skip them. Setting them
explicitly means you can repoint routing or tiles later without a code change.

### Leave out for now

`GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_VISION_MODEL`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`.

Every one of these is optional. With no Gemini key the agents run on deterministic fixtures and the
UI labels each affected card `demo fixture`. With no Telegram token, offers go to the simulated
partner instead and the feed says `simulated recipient`. **Nothing breaks and the demo works.**

When you add `GEMINI_API_KEY` later, also set `DEMO_MODE=false` to actually use it, and redeploy.

> `ALLOW_REAL_OUTREACH` must stay `false`. The app refuses to start if it is `true` while
> `DEMO_MODE` is also `true`, and flipping it lets the Negotiation Agent contact a real
> organisation. Real NGOs are not test fixtures.

## Atlas network access

This is the step that most often breaks a first deploy. Vercel's functions have no fixed IPs, so in
Atlas under **Network Access** add:

```
0.0.0.0/0
```

That opens the cluster to any address, leaving the database password as the only thing protecting
it — so make sure that password is long and random. It is the standard arrangement for serverless,
but be clear-eyed that it is a real widening of exposure.

## Seed the database

The Vercel deployment and your local machine point at the same Atlas cluster, so seed from your
machine:

```powershell
npm run seed
```

It prints whether the redistribution path is live at the current hour. Partners cover roughly
08:00–01:30 IST; outside that the demo correctly shows the compost route instead of the
negotiation, which is real behaviour but not the headline.

## After deploying

1. Open the deployment URL and sign in as `ananya@example.com` / `reloop-demo-password`.
2. Watch the pantry — the feed drives runs itself, no cron needed.
3. Check the map renders and the impact page shows a methodology sheet.

## About the cron job

`vercel.json` schedules `/api/cron/tick` once daily, at 03:00 UTC.

It is deliberately not more frequent: **Hobby accounts reject any expression that would run more
than once a day**, and a deployment carrying `* * * * *` fails outright with
`Hobby accounts are limited to daily cron jobs`.

This costs the demo nothing. The dashboard drives runs itself — the activity feed polls and calls
`advance()` roughly every second while anything is in flight, which is what makes the exchange
visible turn by turn. The cron is only a backstop for runs left unattended with no browser open. On
a Pro plan you can change the schedule to `* * * * *` and the backstop becomes prompt.

## Telegram, once you have a bot

1. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` in Vercel, then redeploy.
2. Register the webhook against the deployed URL:

```powershell
$token = "YOUR_BOT_TOKEN"; $secret = "YOUR_WEBHOOK_SECRET"; $url = "https://YOUR-APP.vercel.app/api/telegram/webhook"
Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/setWebhook" -ContentType "application/json" -Body (@{ url = $url; secret_token = $secret } | ConvertTo-Json)
```

3. `npm run seed` prints a link code per partner. Send `/start <code>` to the bot and that partner
   answers offers for real with inline buttons instead of being simulated.

## Known issues to expect

- **Cold starts.** The first request after idle takes a few seconds while the Mongoose connection
  opens. The connection is cached per warm instance, so it only bites once.
- **Map tiles need internet.** If OpenFreeMap is unreachable the map area shows a notice and the
  pin list below still renders everything.
- **OSRM is a public demo server** and is rate-limited. On failure, distances fall back to a cached
  route and then to a straight-line estimate, and the feed labels which was used.
