# AEGIS Portfolio — stocktracker

Self-updating portfolio dashboard + AI chat advisor with daily alerts and a weekly Sunday digest.

## Features

- 📊 **Daily dashboard** — auto-updates each weekday morning, shows HOLD / WATCH / ACTION status per stock
- 📈 **Price history chart** — populates over time, last 30 days at a glance
- 💬 **Interactive chat** — ask the AI advisor anything, with live web search
- ⚠ **Action-needed alerts** — email + optional Slack/Discord when something material happens
- 📬 **Weekly Sunday digest** — synthesized review of the week's moves, alerts, and what to watch
- ⚙️ **Config-driven** — add or remove stocks by editing one file

## Project structure

```
stocktracker/
├── config.json                          ← ADD/REMOVE STOCKS HERE
├── .github/workflows/
│   ├── daily-update.yml                 Mon–Fri 9:30am ET
│   └── weekly-digest.yml                Sun 12:00pm ET
├── scripts/
│   ├── update-analysis.js               Daily analysis + alert email
│   └── weekly-digest.js                 Sunday digest email
├── api/chat.js                          Vercel serverless function (chat proxy)
├── data/
│   ├── latest.json                      Today's analysis
│   ├── history/                         Date-archived daily snapshots
│   ├── history-index.json               List of available dates
│   └── digests/                         Archived weekly digests
├── index.html                           Dashboard (homepage)
├── chat.html                            Interactive AI chat
├── package.json
├── vercel.json
└── README.md
```

## Setup

### 1. Push these files to GitHub
Upload everything to `github.com/benjsteele/stocktracker`.

### 2. Get your API keys
- **Anthropic**: console.anthropic.com → API Keys → create one
- **Resend** (email): resend.com → API Keys → create one (free, 100/day)

### 3. Connect to Vercel
1. Sign up at [vercel.com](https://vercel.com) with your GitHub account (free)
2. **Add New → Project** → import your `stocktracker` repo
3. Framework preset: **Other**
4. Click **Environment Variables** and add:
   - `ANTHROPIC_API_KEY` = your Anthropic key
   - `ACCESS_CODE` = any password (typed once when you open the chat page)
5. **Deploy**

Your dashboard goes live at `https://stocktracker-<random>.vercel.app/` — bookmark it.

### 4. Configure GitHub Actions
In your repo on GitHub:

1. **Settings → Secrets and variables → Actions → New repository secret**:
   - `ANTHROPIC_API_KEY` (same as Vercel)
   - `RESEND_API_KEY` (from Resend)
2. **Settings → Variables → New variable**:
   - `DASHBOARD_URL` = your Vercel URL (so emails link back)
3. **Settings → Actions → General** → Workflow permissions: **Read and write**
4. **Actions → Daily Portfolio Analysis → Run workflow**
   - Set `force_notify: true` for this first run to verify email
5. Wait ~30 seconds. Check `b_steele@live.co.uk` (including Junk) for the test email.

### 5. Verify weekly digest
- **Actions → Weekly Digest → Run workflow** (any time, to test)
- It needs at least 1 daily run in history first
- You'll get a digest email even if no daily history exists yet — it'll skip gracefully

## Adding or removing stocks

Edit `config.json` — that's it. The daily script, weekly digest, dashboard, and chat all read from it.

```json
{
  "portfolio": [
    { "ticker": "MSFT", "name": "Microsoft", "color": "#00d4ff" },
    { "ticker": "TSLA", "name": "Tesla", "color": "#cc0000" }
  ],
  "notifyEmail": "b_steele@live.co.uk"
}
```

Commit. Vercel auto-redeploys. Next daily run picks up the new portfolio.

## Schedules

| Workflow | When | What it does |
|---|---|---|
| Daily Analysis | Mon–Fri 13:30 UTC (9:30am ET) | Runs Claude with web search, writes `data/latest.json`, emails only if action needed |
| Weekly Digest | Sun 16:00 UTC (12:00pm ET) | Synthesizes the week, emails digest regardless |

## Cost

| Service | Cost |
|---|---|
| Anthropic API | ~$2–5/month (daily + weekly + chat) |
| Resend | Free (100 emails/day, you'll use <10/month) |
| Vercel | Free (hobby tier) |
| GitHub Actions | Free (public repo) |

## Security

- API keys live in Vercel env vars + GitHub Secrets — never in the repo, never in the browser
- The chat page is gated by `ACCESS_CODE` so random visitors can't run up your bill
- If you ever leak a key: **rotate immediately** at console.anthropic.com / resend.com

## Not financial advice

This is a research tool that summarizes public information using AI. All decisions are yours.
