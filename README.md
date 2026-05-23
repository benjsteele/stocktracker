# AEGIS Portfolio

Self-updating portfolio dashboard + AI chat advisor with daily alerts and a weekly Sunday digest.

## How it works

```
GitHub Actions (scheduled)
        │
        ▼
scripts/update-analysis.js
  - Calls Claude API with web search
  - Produces structured JSON (prices, status, alerts)
  - Writes data/latest.json + data/history/<date>.json
  - Commits and pushes back to the repo
  - Emails you only if action_required = true (needs RESEND_API_KEY)
        │
        ▼
Vercel (auto-redeploys on every push to main)
  ├── index.html        Public dashboard — reads data/latest.json + history
  ├── chat.html         AI chat — access code gated, calls /api/chat
  └── api/chat.js       Serverless function — proxies to Claude API, keeps key server-side
```

**Data flow:**
1. GitHub Actions runs `update-analysis.js` Mon-Fri at 9:30am ET
2. Claude searches the web for current prices and news, returns structured JSON
3. The JSON is committed to `data/` in the repo and pushed to `main`
4. Vercel redeploys automatically on that push
5. The dashboard at `/` reads the fresh JSON and renders the portfolio status
6. The chat at `/chat.html` is a separate live session — each question goes to Claude with web search in real time

**Nothing is stored server-side.** All data lives in the repo as JSON files. Vercel just serves the static files and runs the chat proxy function.

## Project structure

```
stocktracker/
├── config.json                     Edit this to add/remove stocks
├── .github/workflows/
│   ├── daily-update.yml            Mon-Fri 9:30am ET
│   └── weekly-digest.yml           Sun 12:00pm ET
├── scripts/
│   ├── update-analysis.js          Daily analysis runner
│   └── weekly-digest.js            Sunday digest runner
├── api/
│   └── chat.js                     Vercel serverless chat proxy
├── data/
│   ├── latest.json                 Today's analysis (auto-updated)
│   ├── history/                    Daily snapshots by date
│   ├── history-index.json          Index of available dates for chart
│   └── digests/                    Weekly digest archive
├── index.html                      Dashboard (public)
├── chat.html                       AI chat (access code gated)
├── vercel.json
└── package.json
```

## Setup

### 1. GitHub repo
Push everything to `github.com/benjsteele/stocktracker` on the `main` branch.

**Settings → Actions → General:**
- Actions permissions: Allow all actions
- Workflow permissions: Read and write

### 2. Vercel
1. Sign up at [vercel.com](https://vercel.com) with your GitHub account
2. Add New → Project → import `stocktracker`
3. Framework preset: **Other**
4. Environment Variables:
   - `ANTHROPIC_API_KEY` — from [console.anthropic.com](https://console.anthropic.com)
   - `ACCESS_CODE` — any password you choose (gates the chat page)
5. Deploy — your site goes live at `https://stocktracker-rose.vercel.app`

Note: use the **production URL** (no random hash). Preview deployment URLs require Vercel login.

### 3. GitHub Secrets and Variables
**Settings → Secrets and variables → Actions:**

Secrets:
- `ANTHROPIC_API_KEY` — same key as Vercel
- `RESEND_API_KEY` — optional, only needed for email alerts (see below)

Variables:
- `DASHBOARD_URL` — your production Vercel URL (used in email links)

### 4. Run the first analysis
Actions → Daily Portfolio Analysis → Run workflow → Run workflow

Takes ~30-60 seconds. The dashboard will show live data on completion.

## Email alerts (optional)

Without Resend, the workflow still runs and updates the dashboard — you just won't receive emails.

To enable emails:
1. Sign up free at [resend.com](https://resend.com) (100 emails/day free)
2. Create an API key
3. Add `RESEND_API_KEY` to GitHub Secrets
4. Test: re-run the workflow with `force_notify: true`

Emails are sent to the `notifyEmail` address in `config.json` and only trigger when `action_required = true` (i.e. a stock has ACTION status or a high-level alert).

## Adding or removing stocks

Edit `config.json`:

```json
{
  "portfolio": [
    { "ticker": "MSFT", "name": "Microsoft", "color": "#00d4ff" },
    { "ticker": "NVDA", "name": "NVIDIA", "color": "#76b900" }
  ],
  "notifyEmail": "you@example.com",
  "holderStyle": "long-term"
}
```

Commit and push to `main`. Vercel redeploys automatically. The next daily run picks up the new portfolio.

## Schedules

| Workflow | Schedule | Behaviour |
|---|---|---|
| Daily Analysis | Mon-Fri 13:30 UTC (9:30am ET) | Runs Claude, writes JSON, emails only if action needed |
| Weekly Digest | Sun 16:00 UTC (12:00pm ET) | Synthesizes the week, emails digest unconditionally |

## Cost

| Service | Cost |
|---|---|
| Anthropic API | ~$2-5/month (daily + weekly + chat usage) |
| Resend | Free (100 emails/day) |
| Vercel | Free (hobby tier) |
| GitHub Actions | Free |

## Security

- API keys are in Vercel env vars and GitHub Secrets — never in the repo or browser
- The chat page requires `ACCESS_CODE` — random visitors cannot use your API quota
- The dashboard is public read-only — no keys exposed
- Rotate any leaked key immediately at console.anthropic.com or resend.com

## Not financial advice

This is a research tool that summarizes public information using AI. All decisions are yours.
