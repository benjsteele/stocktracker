// scripts/weekly-digest.js
// Runs every Sunday. Reads the last 7 days of analyses from data/history/,
// has Claude synthesize a weekly digest, and emails it.

import fs from 'fs';

const API_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
if (!API_KEY) { console.error('Missing ANTHROPIC_API_KEY'); process.exit(1); }
if (!RESEND_KEY) { console.error('Missing RESEND_API_KEY'); process.exit(1); }

const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
const NOTIFY_EMAIL = config.notifyEmail;
const PORTFOLIO = config.portfolio;

function loadRecentHistory(days = 7) {
  const indexPath = 'data/history-index.json';
  if (!fs.existsSync(indexPath)) return [];
  const dates = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const recent = dates.slice(-days);
  return recent.map(d => {
    const p = `data/history/${d}.json`;
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  }).filter(Boolean);
}

async function callClaude(historyData) {
  const SYSTEM = `You are AEGIS, an elite long-term portfolio advisor.
You are writing a WEEKLY DIGEST for the user, who holds: ${PORTFOLIO.map(s => `${s.name} (${s.ticker})`).join(', ')}.

You will be given the past week of daily analyses. Synthesize them into a clear weekly digest.

You MUST respond with ONLY valid JSON (no markdown, no prose outside):

{
  "week_ending": "YYYY-MM-DD",
  "headline": "1 sentence summary of the week for the portfolio",
  "winners_losers": "1-2 sentences identifying the standout movers (best/worst) of the week",
  "stocks": {
${PORTFOLIO.map(s => `    "${s.ticker}": {
      "week_change_pct": 0.00,
      "current_price": 0.00,
      "key_event": "the most important development for this stock this week (1 sentence)",
      "weekly_take": "2-3 sentence analyst take on what happened and what to think about it"
    }`).join(',\n')}
  },
  "alerts_fired": ["bullet list of any alerts that triggered this week, or empty array"],
  "long_term_check": "2-3 sentence reaffirmation or concern about the long-term thesis after this week",
  "next_week_watch": "1-2 sentence note on what to watch in the coming week (earnings, macro events, etc)"
}

Rules:
- week_change_pct = calculated from first and last price in the history.
- Be honest: if it was a quiet week, say so.
- This is a digest for a LONG-TERM HOLDER. Don't suggest trades unless something truly material is happening.`;

  const userMsg = `Here are the past ${historyData.length} days of analyses:\n\n${JSON.stringify(historyData, null, 2)}\n\nProduce the weekly digest JSON.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      system: SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  const cleaned = text.replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim();
  return JSON.parse(cleaned);
}

function escapeHTML(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function buildDigestHTML(d) {
  const dashboardUrl = process.env.DASHBOARD_URL || '#';
  const stockRows = Object.entries(d.stocks || {}).map(([t, s]) => {
    const changeColor = (s.week_change_pct ?? 0) >= 0 ? '#76b900' : '#ff4466';
    const sign = (s.week_change_pct ?? 0) >= 0 ? '+' : '';
    return `
      <tr><td style="padding:14px;border:1px solid #1a2530;background:#0f1620;border-radius:6px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-family:monospace;font-size:14px;font-weight:700;color:#00d4ff;letter-spacing:1px;">${t}</td>
          <td align="right" style="font-family:monospace;font-size:13px;color:${changeColor};font-weight:700;">${sign}${(s.week_change_pct ?? 0).toFixed(2)}%</td>
        </tr></table>
        <div style="font-family:monospace;font-size:11px;color:#8899aa;margin:6px 0;">Current: $${(s.current_price ?? 0).toFixed(2)}</div>
        <div style="font-family:Arial,sans-serif;font-size:13px;color:#e8f4ff;font-weight:600;margin-bottom:6px;">${escapeHTML(s.key_event || '')}</div>
        <div style="font-family:Arial,sans-serif;font-size:12px;color:#8899aa;line-height:1.6;">${escapeHTML(s.weekly_take || '')}</div>
      </td></tr>
      <tr><td style="height:10px;"></td></tr>
    `;
  }).join('');

  const alertsHTML = (d.alerts_fired || []).length > 0
    ? `<div style="padding:12px;background:rgba(255,153,0,0.08);border:1px solid rgba(255,153,0,0.3);border-radius:6px;margin-bottom:16px;">
         <div style="font-family:monospace;font-size:10px;color:#ff9900;letter-spacing:2px;margin-bottom:8px;">ALERTS FIRED THIS WEEK</div>
         <ul style="margin:0;padding-left:20px;font-family:Arial,sans-serif;font-size:12px;color:#c8d8e8;line-height:1.7;">
           ${d.alerts_fired.map(a => `<li>${escapeHTML(a)}</li>`).join('')}
         </ul>
       </div>`
    : `<div style="padding:10px 12px;background:rgba(118,185,0,0.08);border:1px solid rgba(118,185,0,0.3);border-radius:6px;margin-bottom:16px;font-family:Arial,sans-serif;font-size:12px;color:#76b900;">
         ✓ No alerts fired this week — clean run.
       </div>`;

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#080c12;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#080c12;padding:20px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#0a1018;border:1px solid #1a2530;border-radius:8px;overflow:hidden;">
      <tr><td style="padding:20px;border-bottom:1px solid rgba(0,212,255,0.2);background:rgba(0,212,255,0.04);">
        <table width="100%"><tr>
          <td><div style="font-family:monospace;font-size:16px;font-weight:700;color:#e8f4ff;letter-spacing:2px;">⬡ WEEKLY DIGEST</div>
              <div style="font-family:monospace;font-size:10px;color:rgba(0,212,255,0.7);letter-spacing:2px;margin-top:2px;">WEEK ENDING ${d.week_ending}</div></td>
          <td align="right"><div style="font-family:monospace;font-size:10px;color:#00d4ff;border:1px solid #00d4ff;padding:4px 10px;border-radius:4px;letter-spacing:2px;background:rgba(0,212,255,0.05);">SUNDAY BRIEF</div></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:20px;">
        <div style="font-family:Arial,sans-serif;font-size:14px;color:#e8f4ff;line-height:1.6;padding:14px;background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.25);border-radius:6px;margin-bottom:10px;font-weight:600;">
          ${escapeHTML(d.headline || '')}
        </div>
        <div style="font-family:Arial,sans-serif;font-size:12px;color:#8899aa;line-height:1.6;margin-bottom:16px;padding:0 4px;">
          ${escapeHTML(d.winners_losers || '')}
        </div>
        ${alertsHTML}
        <div style="font-family:monospace;font-size:10px;color:#667788;letter-spacing:2px;margin-bottom:8px;padding-left:4px;">PER-STOCK BREAKDOWN</div>
        <table width="100%" cellpadding="0" cellspacing="0">${stockRows}</table>
        <div style="padding:14px;border:1px dashed rgba(0,212,255,0.3);border-radius:6px;background:rgba(0,212,255,0.04);margin-top:8px;margin-bottom:12px;">
          <div style="font-family:monospace;font-size:10px;color:#00d4ff;letter-spacing:2px;margin-bottom:6px;">LONG-TERM THESIS CHECK</div>
          <div style="font-family:Arial,sans-serif;font-size:12px;color:#c8d8e8;line-height:1.6;">${escapeHTML(d.long_term_check || '')}</div>
        </div>
        <div style="padding:14px;border:1px solid rgba(255,153,0,0.25);border-radius:6px;background:rgba(255,153,0,0.04);">
          <div style="font-family:monospace;font-size:10px;color:#ff9900;letter-spacing:2px;margin-bottom:6px;">NEXT WEEK · WATCH FOR</div>
          <div style="font-family:Arial,sans-serif;font-size:12px;color:#c8d8e8;line-height:1.6;">${escapeHTML(d.next_week_watch || '')}</div>
        </div>
        ${dashboardUrl !== '#' ? `<div style="text-align:center;margin-top:20px;">
          <a href="${dashboardUrl}" style="font-family:monospace;font-size:11px;color:#00d4ff;text-decoration:none;letter-spacing:2px;border:1px solid #00d4ff;padding:8px 16px;border-radius:4px;display:inline-block;">VIEW DASHBOARD →</a>
        </div>` : ''}
      </td></tr>
      <tr><td style="padding:14px;border-top:1px solid #1a2530;text-align:center;font-family:monospace;font-size:10px;color:#445566;letter-spacing:2px;">
        AEGIS · WEEKLY DIGEST · NOT FINANCIAL ADVICE
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

async function sendDigest(digest) {
  const fromAddr = process.env.RESEND_FROM || 'AEGIS <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddr,
      to: [NOTIFY_EMAIL],
      subject: `📊 AEGIS Weekly Digest — ${digest.week_ending}`,
      html: buildDigestHTML(digest),
    }),
  });
  if (!res.ok) throw new Error(`Email failed: ${res.status} ${await res.text()}`);
  console.log(`✓ Weekly digest emailed to ${NOTIFY_EMAIL}`);
}

async function main() {
  console.log('Running AEGIS weekly digest...');
  const history = loadRecentHistory(7);
  if (history.length === 0) {
    console.log('No history available yet — skipping digest.');
    return;
  }
  console.log(`Loaded ${history.length} daily analyses`);
  const digest = await callClaude(history);
  fs.mkdirSync('data/digests', { recursive: true });
  fs.writeFileSync(`data/digests/${digest.week_ending}.json`, JSON.stringify(digest, null, 2));
  await sendDigest(digest);
}

main().catch((e) => { console.error('Failed:', e); process.exit(1); });
