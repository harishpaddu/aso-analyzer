# ASO Analyzer — Play Store Intelligence Tool

Competitive ASO analysis tool for Google Play Store. Paste your app URL + up to 4 competitors and get:

- **Keyword gap analysis** — which high-value keywords you're missing vs. competitors
- **Metadata scores** — title, short desc, long desc, visual optimization scores
- **Side-by-side title comparison** — see exactly what competitors write
- **Key insights** — auto-flagged gaps, wins, and opportunities
- **Experiment recommendations** — prioritized Play Store A/B test ideas with hypotheses

Powered by Claude (claude-sonnet-4).

---

## Deploy on Railway (2 minutes)

### Option A — GitHub → Railway (recommended)

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
3. Select your repo
4. In **Variables**, add:
   ```
   ANTHROPIC_API_KEY = sk-ant-xxxxxxxxxxxx
   ```
5. Railway auto-detects the Dockerfile and deploys. Done.

### Option B — Railway CLI

```bash
npm install -g @railway/cli
railway login
railway init
railway up
railway variables set ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
```

---

## Run locally

```bash
cp .env.example .env
# Add your Anthropic API key to .env

npm install
npm start
# Open http://localhost:3000
```

---

## Project structure

```
aso-analyzer/
├── server.js          # Express server + Anthropic API proxy
├── public/
│   └── index.html     # Full frontend (single file)
├── package.json
├── Dockerfile
├── railway.json
└── .env.example
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ Yes | Your Anthropic API key |
| `PORT` | No | Port to run on (default: 3000) |

---

## Notes

- The Anthropic API key is **never exposed to the browser** — all calls go through the Express server
- Each analysis takes 20–40 seconds (Claude processes all apps in one call)
- Works best with well-known apps; for niche apps it uses package ID inference
