// scripts/update-analysis.js
// Runs daily via GitHub Actions. Calls Claude API with web search,
// produces structured JSON analysis for the portfolio.

import fs from 'fs';

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY');
  process.exit(1);
}

// Load config (single source of truth for portfolio)
const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
const PORTFOLIO = config.portfolio;
const NOTIFY_EMAIL = config.notifyEmail;
const FORCE_NOTIFY = process.env.FORCE_NOTIFY === 'true';

const tickerList = PORTFOLIO.map(s => `${s.name} (${s.ticker})`).join(', ');
const tickersOnly = PORTFOLIO.map(s => s.ticker).join(', ');

const SYSTEM_PROMPT = `You are AEGIS, an elite ${config.holderStyle} portfolio advisor.
The user holds: ${tickerList}.
They are a LONG-TERM HOLDER — minimize noise. Only flag genuine action items.

Use web search to get current market data, news, and price action from the last 24 hours.

You MUST respond with ONLY a valid JSON object (no markdown, no prose before/after) with this exact structure:

{
  "date": "YYYY-MM-DD",
  "market_summary": "1-2 sentence summary of overall market and AI sector today",
  "action_required": false,
  "stocks": {
${PORTFOLIO.map(s => `    "${s.ticker}": {
      "status": "HOLD" | "WATCH" | "ACTION",
      "price": 0.00,
      "change_pct": 0.00,
      "price_note": "$X.XX (+/-Y.Y%)",
      "headline": "the single most important development today (1 sentence)",
      "reasoning": "2-3 sentence analysis for a long-term holder"
    }`).join(',\n')}
  },
  "alerts": [
    { "stock": "TICKER", "level": "high" | "medium", "message": "specific action item" }
  ],
  "long_term_view": "1-2 sentence reaffirmation or concern about the long-term thesis"
}

Rules:
- "ACTION" status is rare — only for material news (major guidance cuts, takeover, fraud, etc).
- "WATCH" = monitor but no action needed.
- "HOLD" = default — keep holding.
- Set "action_required": true ONLY if any stock has "ACTION" status or there is a high-level alert.
- alerts array may be empty on quiet days. That is GOOD. Don't manufacture alerts.
- price MUST be a number (latest market price in USD), change_pct MUST be a number (daily % change).
- Be specific with numbers when search returns them.`;

async function callClaude() {
  const userMsg = `Analyze my portfolio for ${new Date().toISOString().slice(0, 10)}. Search for current prices, news, and any material developments for ${tickersOnly}. Return the JSON only.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`API error ${res.status}: ${txt}`);
  }

  const data = await res.json();
  const text = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  const cleaned = text.replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim();
  return JSON.parse(cleaned);
}

// ─── NOTIFICATIONS ──────────────────────────────────────────────

function buildEmailHTML(a) {
  const dashboardUrl = process.env.DASHBOARD_URL || '#';
  const stockRows = Object.entries(a.stocks || {}).map(([t, s]) => {
    const statusColor = s.status === 'ACTION' ? '#ff4466' : s.status === 'WATCH' ? '#ff9900' : '#76b900';
    return `
      <tr><td style="padding:14px;border:1px solid #1a2530;background:#0f1620;border-radius:6px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-family:monospace;font-size:14px;font-weight:700;color:#00d4ff;letter-spacing:1px;">${t}</td>
          <td align="right" style="font-family:monospace;font-size:11px;color:${statusColor};border:1px solid ${statusColor};padding:3px 8px;border-radius:3px;letter-spacing:1px;">${s.status}</td>
        </tr></table>
        <div style="font-family:monospace;font-size:11px;color:#00d4ff;margin:8px 0 4px;">${escapeHTML(s.price_note || '')}</div>
        <div style="font-family:Arial,sans-serif;font-size:13px;color:#e8f4ff;font-weight:600;margin-bottom:6px;">${escapeHTML(s.headline || '')}</div>
        <div style="font-family:Arial,sans-serif;font-size:12px;color:#8899aa;line-height:1.5;">${escapeHTML(s.reasoning || '')}</div>
      </td></tr>
      <tr><td style="height:10px;"></td></tr>
    `;
  }).join('');

  const alertRows = (a.alerts || []).map(al => `
    <tr><td style="padding:10px 12px;background:${al.level === 'high' ? 'rgba(255,68,102,0.15)' : 'rgba(255,153,0,0.15)'};border-left:3px solid ${al.level === 'high' ? '#ff4466' : '#ff9900'};border-radius:4px;font-family:Arial,sans-serif;font-size:13px;color:#e8f4ff;">
      <strong style="color:${al.level === 'high' ? '#ff4466' : '#ff9900'};letter-spacing:1px;">▲ ${al.stock}</strong> &nbsp; ${escapeHTML(al.message)}
    </td></tr>
    <tr><td style="height:6px;"></td></tr>
  `).join('');

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#080c12;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#080c12;padding:20px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#0a1018;border:1px solid #1a2530;border-radius:8px;overflow:hidden;">
      <tr><td style="padding:20px;border-bottom:1px solid rgba(0,212,255,0.2);background:rgba(0,212,255,0.04);">
        <table width="100%"><tr>
          <td><div style="font-family:monospace;font-size:16px;font-weight:700;color:#e8f4ff;letter-spacing:2px;">⬡ AEGIS ALERT</div>
              <div style="font-family:monospace;font-size:10px;color:rgba(0,212,255,0.7);letter-spacing:2px;margin-top:2px;">PORTFOLIO INTELLIGENCE · ${a.date}</div></td>
          <td align="right"><div style="font-family:monospace;font-size:10px;color:#ff4466;border:1px solid #ff4466;padding:4px 10px;border-radius:4px;letter-spacing:2px;background:rgba(255,68,102,0.05);">ACTION NEEDED</div></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:20px;">
        <div style="font-family:Arial,sans-serif;font-size:13px;color:#c8d8e8;line-height:1.6;padding:14px;background:rgba(255,68,102,0.06);border:1px solid rgba(255,68,102,0.3);border-radius:6px;margin-bottom:16px;">
          <div style="font-family:monospace;font-size:10px;color:#8899aa;letter-spacing:2px;margin-bottom:6px;">MARKET SUMMARY</div>
          ${escapeHTML(a.market_summary || '')}
        </div>
        ${alertRows ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">${alertRows}</table>` : ''}
        <table width="100%" cellpadding="0" cellspacing="0">${stockRows}</table>
        ${a.long_term_view ? `
        <div style="padding:14px;border:1px dashed rgba(0,212,255,0.3);border-radius:6px;background:rgba(0,212,255,0.04);margin-top:8px;">
          <div style="font-family:monospace;font-size:10px;color:#00d4ff;letter-spacing:2px;margin-bottom:6px;">LONG-TERM THESIS</div>
          <div style="font-family:Arial,sans-serif;font-size:12px;color:#c8d8e8;line-height:1.6;">${escapeHTML(a.long_term_view)}</div>
        </div>` : ''}
        ${dashboardUrl !== '#' ? `<div style="text-align:center;margin-top:20px;">
          <a href="${dashboardUrl}" style="font-family:monospace;font-size:11px;color:#00d4ff;text-decoration:none;letter-spacing:2px;border:1px solid #00d4ff;padding:8px 16px;border-radius:4px;display:inline-block;">VIEW FULL DASHBOARD →</a>
        </div>` : ''}
      </td></tr>
      <tr><td style="padding:14px;border-top:1px solid #1a2530;text-align:center;font-family:monospace;font-size:10px;color:#445566;letter-spacing:2px;">
        AEGIS · AUTOMATED · NOT FINANCIAL ADVICE
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

function escapeHTML(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

async function sendEmail(analysis) {
  if (!process.env.RESEND_API_KEY) {
    console.log('  ↳ Email skipped (no RESEND_API_KEY set)');
    return;
  }
  const fromAddr = process.env.RESEND_FROM || 'AEGIS <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddr,
      to: [NOTIFY_EMAIL],
      subject: `⚠ AEGIS Alert: Action needed (${analysis.date})`,
      html: buildEmailHTML(analysis),
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error('  ✗ Email failed:', res.status, t);
  } else {
    console.log(`  ✓ Email sent to ${NOTIFY_EMAIL}`);
  }
}

async function sendWebhook(analysis) {
  const url = process.env.WEBHOOK_URL;
  if (!url) {
    console.log('  ↳ Webhook skipped (no WEBHOOK_URL set)');
    return;
  }
  const alertList = (analysis.alerts || []).map(a => `• *${a.stock}* — ${a.message}`).join('\n');
  const stockSummary = Object.entries(analysis.stocks || {})
    .filter(([, s]) => s.status !== 'HOLD')
    .map(([t, s]) => `*${t}* [${s.status}]: ${s.headline}`)
    .join('\n');
  const summaryText = `⚠ *AEGIS Alert — ${analysis.date}*\n\n${analysis.market_summary}\n\n${alertList || 'No specific alerts'}\n\n${stockSummary}`;

  let body;
  if (url.includes('discord.com')) body = { content: summaryText };
  else if (url.includes('hooks.slack.com')) body = { text: summaryText };
  else body = { text: summaryText, analysis };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error('  ✗ Webhook failed:', res.status);
  else console.log(`  ✓ Webhook delivered`);
}

// ─── HISTORY INDEX ──────────────────────────────────────────────
// Maintains data/history-index.json — list of all available dates,
// so the dashboard can fetch history without listing the directory.

function updateHistoryIndex(dateStr) {
  const indexPath = 'data/history-index.json';
  let dates = [];
  if (fs.existsSync(indexPath)) {
    try { dates = JSON.parse(fs.readFileSync(indexPath, 'utf-8')); } catch {}
  }
  if (!dates.includes(dateStr)) dates.push(dateStr);
  dates.sort();
  // Keep last 90 days in index (chart shows ~30 day window)
  if (dates.length > 90) dates = dates.slice(-90);
  fs.writeFileSync(indexPath, JSON.stringify(dates));
}

// ─── MAIN ───────────────────────────────────────────────────────

async function main() {
  console.log('Running AEGIS daily analysis...');
  const analysis = await callClaude();
  analysis.generated_at = new Date().toISOString();

  fs.mkdirSync('data/history', { recursive: true });
  fs.writeFileSync('data/latest.json', JSON.stringify(analysis, null, 2));

  const dateStr = analysis.date || new Date().toISOString().slice(0, 10);
  fs.writeFileSync(`data/history/${dateStr}.json`, JSON.stringify(analysis, null, 2));
  updateHistoryIndex(dateStr);

  console.log(`✓ Analysis saved for ${dateStr}`);
  console.log(`  Action required: ${analysis.action_required}`);
  console.log(`  Alerts: ${analysis.alerts?.length || 0}`);

  if (analysis.action_required || FORCE_NOTIFY) {
    console.log('Dispatching notifications...');
    await Promise.all([sendEmail(analysis), sendWebhook(analysis)]);
  } else {
    console.log('No action required — notifications skipped.');
  }
}

main().catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});
