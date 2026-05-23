import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// In-memory rate limiter — 20 requests per minute per IP
const rateMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const window = 60_000;
  const limit = 20;
  const entry = rateMap.get(ip) || { count: 0, resetAt: now + window };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + window; }
  entry.count++;
  rateMap.set(ip, entry);
  return entry.count > limit;
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function loadPortfolio() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config.json'), 'utf-8'));
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
  // Restrict CORS to same origin — this API is not a public service
  const origin = req.headers.origin;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Access-Code');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit by IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  // Access code check (timing-safe)
  const requiredCode = process.env.ACCESS_CODE;
  if (requiredCode) {
    const provided = String(req.headers['x-access-code'] || '');
    if (!timingSafeEqual(provided, requiredCode)) {
      return res.status(401).json({ error: 'Invalid access code' });
    }
  }

  // Lightweight probe — used by the gate to verify the code without calling Claude
  if (req.body?.probe === true) {
    return res.status(200).json({ ok: true });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server not configured (missing ANTHROPIC_API_KEY)' });
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  // Basic payload limits — prevent oversized requests
  if (messages.length > 40) {
    return res.status(400).json({ error: 'Too many messages in conversation' });
  }
  for (const m of messages) {
    if (typeof m.content === 'string' && m.content.length > 8000) {
      return res.status(400).json({ error: 'Message too long' });
    }
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
