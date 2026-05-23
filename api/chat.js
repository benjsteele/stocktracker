// api/chat.js
// Vercel serverless function — proxies chat requests to Anthropic API.
// Keeps the API key server-side (never exposed to the browser).

import fs from 'fs';
import path from 'path';

function loadPortfolio() {
  try {
    const cfgPath = path.join(process.cwd(), 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    return cfg.portfolio || [];
  } catch {
    return [];
  }
}

function buildSystemPrompt() {
  const portfolio = loadPortfolio();
  const list = portfolio.length
    ? portfolio.map(s => `${s.name} (${s.ticker})`).join(', ')
    : 'their portfolio';
  return `You are AEGIS (Advanced Equity & Growth Intelligence System), an elite portfolio advisor.
The user holds: ${list}.
The user is a LONG-TERM HOLDER — minimize noise, only flag genuine action items.

ALWAYS:
- Use web search for current market context (prices, news, last 24 hours)
- Default to HOLD unless there's a strong reason otherwise
- Be decisive and direct — no hedging or vague disclaimers
- Keep responses concise but information-dense
- Use markdown: **bold** for key figures, bullet points for clarity
- Start with a one-line verdict, then details

If asked about one stock, focus on that one. If asked generally, cover all holdings.`;
}

export default async function handler(req, res) {
  // CORS (optional — same-origin works without this, but doesn't hurt)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Access-Code');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple access code check (prevents random strangers from running up your bill)
  const requiredCode = process.env.ACCESS_CODE;
  if (requiredCode) {
    const provided = req.headers['x-access-code'];
    if (provided !== requiredCode) {
      return res.status(401).json({ error: 'Invalid access code' });
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server not configured (missing ANTHROPIC_API_KEY)' });
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: buildSystemPrompt(),
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages,
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(r.status).json({ error: `Anthropic API error: ${err}` });
    }

    const data = await r.json();
    const reply = data.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
