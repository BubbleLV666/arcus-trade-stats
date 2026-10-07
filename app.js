/* Arcus Trade Stats — static, no backend. Reads the public Arcus REST API straight from the browser. */
(() => {
'use strict';
const API = 'https://api.arcus.xyz/v1', PTS = 'https://points-api.arcus.xyz/v1';
const SC = 1e9;                       // stats / leaderboard integers are scaled by 1e9
const VERSION = 'v1.0';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = x => { const v = parseFloat(x); return isFinite(v) ? v : 0; };
const fmt = (x, d = 2) => x == null || !isFinite(x) ? '—' : x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const sgn = (x, d = 2) => x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + fmt(Math.abs(x), d);
const money = (x, d = 2) => x == null || !isFinite(x) ? '—' : (x < 0 ? '−' : '') + '$' + fmt(Math.abs(x), d);
const smoney = (x, d = 2) => x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + '$' + fmt(Math.abs(x), d);
const big = x => { const a = Math.abs(x); return a >= 1e9 ? fmt(x / 1e9, 2) + 'B' : a >= 1e6 ? fmt(x / 1e6, 2) + 'M' : a >= 1e4 ? fmt(x / 1e3, 1) + 'K' : fmt(x, 0); };
const cls = x => x > 1e-9 ? 'pos' : x < -1e-9 ? 'neg' : '';
const pxf = p => p == null ? '—' : p >= 1000 ? fmt(p, 2) : p >= 1 ? fmt(p, 3) : fmt(p, 5);
const dt = us => new Date(us / 1000).toLocaleString('en-US', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const dtl = us => new Date(us / 1000).toLocaleString('en-US', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const dtlU = us => new Date(us / 1000).toLocaleString('en-US', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
const dur = s => { s = Math.max(0, s | 0); const d = s / 86400 | 0, h = (s % 86400) / 3600 | 0, m = (s % 3600) / 60 | 0; return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`; };
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------------- throttled fetch (per-IP bucket 1500 / 25 per s) */
const bucket = { tokens: 1300, t: Date.now() };
async function take(w) {
  for (;;) {
    const now = Date.now(); bucket.tokens = Math.min(1500, bucket.tokens + (now - bucket.t) / 1000 * 25); bucket.t = now;
    if (bucket.tokens >= w) { bucket.tokens -= w; return; }
    await sleep(Math.max(80, (w - bucket.tokens) / 25 * 1000));
  }
}
async function get(base, path, params = {}, w = 20) {
  const q = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v != null) q.set(k, v);
  const url = base + path + (q.toString() ? '?' + q : '');
  for (let a = 0; a < 5; a++) {
    await take(w);
    let r; try { r = await fetch(url); } catch (e) { await sleep(800 * (a + 1)); continue; }
    if (r.status === 429) { bucket.tokens = 0; await sleep(1500 * (a + 1)); continue; }
    if (r.status >= 500) { await sleep(700 * (a + 1)); continue; }
    let body = null; try { body = await r.json(); } catch (e) { }
    if (!r.ok) { const err = new Error((body && body.error) || ('HTTP ' + r.status)); err.status = r.status; throw err; }
    return body;
  }
  throw new Error('API unavailable or rate limit exceeded, please try again later');
}

/* ---------------------------------------------------------------- state */
let S = null, runId = 0, autoTimer = null;
const OLD_CARDS = ['summary', 'volume', 'pnl', 'equity', 'pnlchart', 'risk', 'positions', 'activity', 'curve', 'bymarket', 'daily', 'hourly', 'funding', 'transfers', 'orders', 'fills', 'season'];
const DEFAULT_CARDS = ['summary', 'volume', 'pnl', 'equity', 'pnlchart', 'risk', 'positions', 'activity', 'curve', 'bymarket', 'daily', 'hourly', 'category', 'orderflow', 'feetier', 'standing', 'limits', 'funding', 'transfers', 'orders', 'fills', 'season'];
let enabled = new Set(store.get('cards', DEFAULT_CARDS));
{ const seen = new Set(store.get('cards_seen', OLD_CARDS)); DEFAULT_CARDS.forEach(id => { if (!seen.has(id)) enabled.add(id); }); store.set('cards_seen', DEFAULT_CARDS); store.set('cards', [...enabled]); }   // cards added in later versions switch on automatically
let range = store.get('range', 'week');

/* ---------------------------------------------------------------- charts */
function lineChart(box, pts, o) {
  const W = box.clientWidth || 500, H = box.clientHeight || 220, m = { l: 54, r: 10, t: 8, b: 22 };
  if (pts.length < 2) { box.innerHTML = '<div class="empty">Not enough data</div>'; return; }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  let y0 = Math.min(...ys), y1 = Math.max(...ys); if (o.zero) { y0 = Math.min(y0, 0); y1 = Math.max(y1, 0); }
  if (y1 - y0 < (o.minRange || 1e-9)) { const c = (y0 + y1) / 2; y0 = c - (o.minRange || 1) / 2; y1 = c + (o.minRange || 1) / 2; }
  const pad = (y1 - y0) * .08; y0 -= pad; y1 += pad;
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const X = t => m.l + (t - x0) / ((x1 - x0) || 1) * (W - m.l - m.r), Y = v => H - m.b - (v - y0) / ((y1 - y0) || 1) * (H - m.t - m.b);
  let g = '';
  for (let i = 0; i <= 4; i++) { const v = y0 + (y1 - y0) * i / 4, y = Y(v); g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="var(--grid)"/><text x="${m.l - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="var(--ink-3)">${o.axis(v)}</text>`; }
  for (let i = 0; i <= 4; i++) { const t = x0 + (x1 - x0) * i / 4; g += `<text x="${X(t)}" y="${H - 5}" text-anchor="${i == 0 ? 'start' : i == 4 ? 'end' : 'middle'}" font-size="11" fill="var(--ink-3)">${o.xfmt(t)}</text>`; }
  if (o.zero) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--ink-3)" stroke-dasharray="3 3"/>`;
  const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('');
  const base = Y(Math.max(y0, Math.min(y1, 0)));
  const area = o.area ? `<path d="${d}L${X(x1)} ${base}L${X(x0)} ${base}Z" fill="${o.color}" opacity=".10"/>` : '';
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}${area}<path d="${d}" fill="none" stroke="${o.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><g class="hv" style="display:none"><line y1="${m.t}" y2="${H - m.b}" stroke="var(--ink-3)"/><circle r="4" fill="${o.color}" stroke="var(--surface)" stroke-width="2"/></g></svg><div class="tt"></div>`;
  hover(box, W, H, (px) => {
    let lo = 0, hi = pts.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (X(pts[mid][0]) < px) lo = mid + 1; else hi = mid; }
    const p = pts[lo]; return { x: X(p[0]), y: Y(p[1]), html: `<span class="k">${o.tfmt(p[0])}</span><br><b class="num">${o.tip(p[1])}</b>` };
  });
}
function barChart(box, items, o) {
  const W = box.clientWidth || 500, H = box.clientHeight || 220, m = { l: 54, r: 8, t: 8, b: 24 };
  if (!items.length) { box.innerHTML = '<div class="empty">No data</div>'; return; }
  let y0 = Math.min(0, ...items.map(i => i.v)), y1 = Math.max(0, ...items.map(i => i.v)); if (y1 === y0) y1 = y0 + 1;
  const Y = v => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b), bw = (W - m.l - m.r) / items.length, gap = Math.min(2, bw * .15);
  let g = ''; for (let i = 0; i <= 4; i++) { const v = y0 + (y1 - y0) * i / 4, y = Y(v); g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="var(--grid)"/><text x="${m.l - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="var(--ink-3)">${o.axis(v)}</text>`; }
  const step = Math.ceil(items.length / 8);
  const bars = items.map((it, i) => {
    const w = Math.max(1, Math.min(bw - gap, 56)), x = m.l + i * bw + (bw - w) / 2, yy = Y(Math.max(it.v, 0)), h = Math.max(1, Math.abs(Y(it.v) - Y(0)));
    const lab = i % step === 0 ? `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--ink-3)">${esc(it.label)}</text>` : '';
    return `<rect x="${x}" y="${yy}" width="${w}" height="${h}" rx="${Math.min(3, w / 3)}" fill="${o.color}" data-i="${i}"/>${lab}`;
  }).join('');
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}<line x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--ink-3)"/>${bars}</svg><div class="tt"></div>`;
  const tip = $('.tt', box), svg = $('svg', box);
  box.onmousemove = e => {
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width), i = Math.max(0, Math.min(items.length - 1, Math.floor((px - m.l) / bw)));
    tip.style.display = 'block'; tip.innerHTML = `<span class="k">${esc(items[i].label)}</span><br><b class="num">${o.tip(items[i].v, items[i])}</b>`;
    const bx = box.getBoundingClientRect(); let lx = e.clientX - bx.left + 14; if (lx > bx.width - 150) lx = e.clientX - bx.left - 150; tip.style.left = lx + 'px'; tip.style.top = '8px';
  };
  box.onmouseleave = () => tip.style.display = 'none';
}
function hover(box, W, H, f) {
  const svg = $('svg', box), hv = $('.hv', svg), tip = $('.tt', box);
  box.onmousemove = e => {
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width), p = f(px);
    hv.style.display = ''; const l = hv.firstChild; l.setAttribute('x1', p.x); l.setAttribute('x2', p.x);
    const c = hv.lastChild; c.setAttribute('cx', p.x); c.setAttribute('cy', p.y);
    tip.style.display = 'block'; tip.innerHTML = p.html;
    const bx = box.getBoundingClientRect(); let lx = e.clientX - bx.left + 14; if (lx > bx.width - 150) lx = e.clientX - bx.left - 150; tip.style.left = lx + 'px'; tip.style.top = '8px';
  };
  box.onmouseleave = () => { hv.style.display = 'none'; tip.style.display = 'none'; };
}
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const tshort = t => new Date(t / 1000).toLocaleString('en-US', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const dshort = t => new Date(t / 1000).toLocaleDateString('en-US', { day: '2-digit', month: '2-digit' });

/* ---------------------------------------------------------------- derived data */
function fillStats(fills) {
  const r = { n: fills.length, vol: 0, mvol: 0, tvol: 0, fees: 0, pnl: 0, wins: 0, losses: 0, winSum: 0, lossSum: 0, buyVol: 0, sellVol: 0, byM: {}, byDay: {}, byHour: Array(24).fill(0), curve: [], maxWin: 0, maxLoss: 0 };
  if (!fills.length) return r;
  const asc = fills.slice().sort((a, b) => a.createdAt - b.createdAt);
  let cum = 0;
  for (const f of asc) {
    const v = n(f.size) * n(f.price), fee = n(f.fee), pnl = n(f.closedPnl), maker = f.role === 'MAKER';
    r.vol += v; r.fees += fee; r.pnl += pnl; if (maker) r.mvol += v; else r.tvol += v;
    if (f.side === 'BUY') r.buyVol += v; else r.sellVol += v;
    if (pnl > 0) { r.wins++; r.winSum += pnl; r.maxWin = Math.max(r.maxWin, pnl); } else if (pnl < 0) { r.losses++; r.lossSum += pnl; r.maxLoss = Math.min(r.maxLoss, pnl); }
    const m = r.byM[f.marketDisplayName] || (r.byM[f.marketDisplayName] = { fills: 0, vol: 0, mvol: 0, fees: 0, pnl: 0, wins: 0, losses: 0 });
    m.fills++; m.vol += v; if (maker) m.mvol += v; m.fees += fee; m.pnl += pnl; if (pnl > 0) m.wins++; else if (pnl < 0) m.losses++;
    const d = new Date(f.createdAt / 1000), key = d.toISOString().slice(0, 10);
    const dd = r.byDay[key] || (r.byDay[key] = { vol: 0, net: 0 }); dd.vol += v; dd.net += pnl - fee;
    r.byHour[d.getUTCHours()] += v;
    cum += pnl - fee; r.curve.push([f.createdAt, cum]);
  }
  r.t0 = asc[0].createdAt; r.t1 = asc[asc.length - 1].createdAt;
  if (r.curve.length > 900) { const k = r.curve.length / 900; r.curve = Array.from({ length: 900 }, (_, i) => r.curve[Math.floor(i * k)]).concat([r.curve[r.curve.length - 1]]); }
  return r;
}
function riskCalc(a, mk) {
  const eq = n(a.equity), pos = Object.values(a.positions || {}), out = { eq, rows: [], gross: 0, long: 0, short: 0, mm: 0, im: 0 };
  for (const p of pos) {
    const m = mk[p.marketId] || {}, mid = n(p.markPx), s = n(p.size), notl = Math.abs(n(p.positionValueNotional)) || Math.abs(s * mid);
    const mmf = n(m.maintenanceMarginFraction) || 0.03;
    out.gross += notl; if (s > 0) out.long += notl; else out.short += notl; out.mm += notl * mmf; out.im += n(p.marginUsed);
    out.rows.push({ p, s, mid, notl, mmf });
  }
  for (const r of out.rows) {   // cross-margin liquidation price of this position, all other marks held fixed
    const { s, mid, mmf } = r;
    if (r.p.marginMode === 'ISOLATED') { r.liq = null; continue; }
    const den = s - mmf * Math.abs(s), mmOther = out.mm - mmf * Math.abs(s) * mid;
    const lp = den ? (mmOther - eq + s * mid) / den : null;
    r.liq = lp && lp > 0 ? lp : null; r.dist = r.liq ? Math.abs(r.liq - mid) / mid * 100 : null;
  }
  out.buffer = eq - out.mm; out.lev = eq > 0 ? out.gross / eq : null;
  return out;
}

/* ---------------------------------------------------------------- cards */
/* ---- periods: Total / Arcus weeks / current week / custom range */
const WEEK = 7 * 86400e3;
let period = { key: 'cur' };   // every visit opens on the current week (not remembered between visits)
const seasonStart = S => { const t = S && S.meta && S.meta.season && Date.parse(S.meta.season.starts_at), d = new Date(t || Date.UTC(2026, 8, 30)); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };   // week anchor = 00:00 UTC of the season's first day (Wed 30 Sep)
function weeksList(S) { const st = seasonStart(S), now = Date.now(), a = []; for (let k = 0; st + k * WEEK < now; k++) a.push({ n: k + 1, from: st + k * WEEK, to: Math.min(st + (k + 1) * WEEK, now), end: st + (k + 1) * WEEK - 1, cur: st + (k + 1) * WEEK > now }); return a; }
function getPeriod(S) {   // null = all time; else { label, from, to } in microseconds
  if (period.key === 'total') return null;
  if (period.key === 'custom') return period.from && period.to ? { label: dtlU(period.from * 1000) + ' – ' + dtlU(period.to * 1000) + ' GMT', from: period.from * 1000, to: period.to * 1000 } : null;
  const w = weeksList(S);
  if (period.key === 'cur') { const c = w[w.length - 1]; return c ? { label: `Current week (${c.n})`, from: c.from * 1000, to: Date.now() * 1000 } : null; }
  const m = /^w(\d+)$/.exec(period.key), c = m && w.find(x => x.n === +m[1]);
  return c ? { label: `Week ${c.n}`, from: c.from * 1000, to: c.to * 1000 } : null;
}
const inP = (pr, us) => !pr || (us >= pr.from && us <= pr.to);
function pSeries(S, key) {
  const P = S.portfolio; if (!P) return []; const pr = getPeriod(S);
  const name = pr ? ((Date.now() * 1000 - pr.from) / 864e8 <= 29 ? 'totalMonth' : 'totalAll') : 'total' + { day: 'Day', week: 'Week', month: 'Month', all: 'All' }[range];
  const set = (P.data.find(d => d[0] === name) || [])[1];
  let pts = set && set[key] ? set[key].map(p => [p[0], n(p[1])]) : [];
  if (pr) { pts = pts.filter(p => p[0] >= pr.from && p[0] <= pr.to); if (key === 'pnlHistory' && pts.length) { const b = pts[0][1]; pts = pts.map(p => [p[0], p[1] - b]); } }
  return pts;
}
const periodFunding = S => (S.funding || []).filter(x => inP(getPeriod(S), x.time)).reduce((a, x) => a + n(x.payment), 0);
const fsub = S => { const pr = getPeriod(S); return pr ? pr.label : 'from loaded fills'; };
const rankRows = S => { const r = S.lb && S.lb.vr || {}, f = x => x == null ? '—' : '#' + fmt(x, 0); return row('Volume rank · all time', f(r.all)) + row('Volume rank · last 30 days', f(r.d30)) + row('Volume rank · last 24 hours', f(r.h24)); };
/* ---- hover explanations: label text -> plain-language definition (shown on every row / table header with a match) */
const TIPS = {
  // account / profit
  'PnL by account': 'Equity minus net deposits: everything gained or lost, including unrealized PnL, fees and funding.',
  'ROI on deposit': 'PnL by account divided by net deposits.',
  'Net deposits': 'All deposits minus all withdrawals.',
  'Free collateral': 'Equity that is not locked as initial margin: what is available for new positions.',
  'Unrealized PnL': 'Profit or loss of the currently open positions at today\'s mark prices. Not locked in until the positions are closed.',
  'PnL over period (by equity)': 'Change of the account PnL curve (/portfolio) during the selected period. Deposits and withdrawals are not counted.',
  'Active since': 'Time of the first deposit or transfer to this account.',
  'Pending deposits': 'Deposits that were sent but not yet credited.',
  'Pending withdrawals': 'Withdrawals that were requested but not yet completed.',
  'Realized PnL (closedPnl)': 'Profit or loss locked in by closing (reducing) positions, before fees and funding.',
  'Realized PnL (by fills)': 'Sum of closedPnl over all trades since the account started (from the Arcus leaderboard). Unrealized PnL is not included.',
  'Fees over period': 'Trading fees paid on fills in the selected period. Makers usually pay 0.',
  'Funding over period': 'Funding payments received (+) or paid (−) for holding perpetual positions during the period.',
  'PnL by equity over period': 'Change of equity during the period without deposits and withdrawals. Includes unrealized PnL and any exchange credits.',
  'PnL per $1M volume': 'Net PnL divided by volume, scaled to $1,000,000 traded. A way to compare edge across different sizes. Negative = costs exceed gains.',
  // volume / fees
  'Turnover / deposit': 'Total volume divided by net deposits: how many times the deposit was "turned over".',
  'Fee tier': 'Your trading-fee level. It depends on your rolling 30-day volume (see "Fee tier progress").',
  'Average fill size': 'Total volume divided by the number of fills.',
  'Maker / taker (by volume)': 'Maker = your resting limit order was filled by someone else (usually 0 fee). Taker = you removed liquidity from the book and paid the taker fee. Shown as a share of volume.',
  'Volume rank · all time': 'Your place among all Arcus traders by volume since launch (#1 = most volume).',
  'Volume rank · last 30 days': 'Your place among all Arcus traders by volume over the last 30 days.',
  'Volume rank · last 24 hours': 'Your place among all Arcus traders by volume over the last 24 hours.',
  'PnL rank (all time)': 'Your place among all Arcus traders by realized PnL since launch.',
  // trading style
  'Fills': 'Number of executed trades. One order can be split into several fills.',
  'Volume': 'Total notional traded = sum of size × price over all fills.',
  'Fills per hour': 'Number of fills divided by the time between the first and the last fill in the sample.',
  'Win rate (closing fills)': 'Share of closing fills (fills that reduce a position) with positive realized PnL. Opening fills have no PnL and are ignored.',
  'Average win / loss': 'Average realized PnL of the winning closing fills / of the losing closing fills (before fees).',
  'Profit factor': 'Sum of all winning closing fills divided by the absolute sum of all losing closing fills (before fees). Above 1 means wins outweigh losses; 1.5 = $1.50 won for every $1 lost; below 1 = losing.',
  'Best / worst': 'Largest single winning and largest single losing closing fill (closedPnl, before fees).',
  'Closed PnL − fees': 'Sum of closedPnl of all fills minus all fees paid. Funding and unrealized PnL are not included.',
  'Buys / sells': 'Share of volume that was bought vs sold. A strong tilt means a directional bias or a net long/short position.',
  // risk
  'Maintenance margin': 'Minimum equity needed to keep the positions open. If equity falls below it, liquidation starts.',
  'Margin used (initial)': 'Collateral currently locked by open positions (initial margin).',
  'Buffer to liquidation': 'Equity minus maintenance margin: how much more equity can be lost before liquidation. The % is relative to total position size (gross).',
  'Gross / leverage': 'Gross = sum of the absolute sizes of all positions. Leverage = gross ÷ equity.',
  'Longs': 'Total notional of long positions.',
  'Shorts': 'Total notional of short positions.',
  'Net exposure': 'Longs minus shorts: your net directional exposure. The % shows how one-sided the book is.',
  // orders
  'Resting buy notional': 'Total value of open buy limit orders waiting in the order book.',
  'Resting sell notional': 'Total value of open sell limit orders waiting in the order book.',
  'Filled / placed (by size)': 'Filled size divided by the originally placed size over the sampled orders. Low values mean most orders are cancelled before being hit.',
  'Avg. order size': 'Average notional (price × original size) of the sampled orders.',
  'Median time to cancel': 'Typical time between placing an order and cancelling it (cancelled orders only).',
  'Time in force': 'ALO = post-only (maker only). GTC = good till cancelled. IOC = immediate-or-cancel. FOK = fill-or-kill.',
  // fee tier / limits / season
  '30-day volume': 'Rolling 30-day volume used by Arcus to set the fee tier.',
  'Maker / taker fee': 'Fee per trade in basis points (1 bps = 0.01%). Negative = rebate.',
  'Volume to next tier': 'Additional 30-day volume needed to reach the next fee tier.',
  'Markets with leverage set': 'Markets where a leverage value is stored for this account.',
  'Highest leverage set': 'Highest per-market leverage setting. It is a setting, not the leverage currently used.',
  'Lowest leverage set': 'Lowest per-market leverage setting.',
  'Average leverage set': 'Average of the per-market leverage settings.',
  'Order rate-limit pool (used / cap)': 'Allowance for placing orders. Higher realized volume raises the cap.',
  'Cancel rate-limit pool (used / cap)': 'Allowance for cancelling orders.',
  'Total points distributed': 'Sum of the season points of all participants = everything distributed so far.',
  'Weeks distributed': 'Number of weekly point drops already made.',
  'Average per week': 'Total points distributed divided by the number of weekly drops.',
  'Received': 'Funding payments received.',
  'Paid': 'Funding payments paid.',
  'Cross / isolated': 'Cross = all positions share one collateral pool. Isolated = collateral is limited to each position.',
  'Equity': 'Account value: balance plus unrealized PnL.',
  'Fees': 'Trading fees paid in the period.',
  'Fees (all time)': 'Trading fees paid since the account started.',
  'Fees, all time': 'Trading fees paid since the account started.',
  'Fees, 24h': 'Trading fees paid over the last 24 hours.',
  'Funding (loaded history)': 'Sum of funding payments in the loaded history (the API returns the latest 1,000 payments).',
  'Current week': 'Weeks are counted from Wednesday 00:00 GMT (assumption, not officially confirmed).',
  'Participants': 'Addresses that have points in the current season.',
  'Next drop': 'Time until the next weekly points distribution.',
  'Last drop (local time)': 'Time of the latest weekly points distribution, in your local time.',
  'Volume, all time': 'Total volume traded since the account started.',
  'Turnover': 'Volume divided by deposit.',
  // table headers
  'uPnL': 'Unrealized PnL of the position at the current mark price.',
  'uPnL %': 'Unrealized PnL as a percentage of the entry price move (direction-adjusted).',
  'Margin': 'Collateral locked by this position.',
  'Liq. price': 'Estimated liquidation price with all other marks unchanged (cross margin). An estimate, not the exchange formula.',
  'To liq.': 'Distance from the current mark price to the estimated liquidation price.',
  'Maker %': 'Share of this market\'s volume traded as maker.',
  'Closed PnL': 'Sum of closedPnl in this market, before fees.',
  'Net': 'Closed PnL minus fees in this market.',
  'Win %': 'Share of closing fills with positive PnL in this market.',
  'Vol. rank': 'Rank among all Arcus traders by volume in this window.',
  'PnL rank': 'Rank among all Arcus traders by realized PnL in this window.',
  'Fee rank': 'Rank among all Arcus traders by fees paid in this window.',
  'Realized PnL': 'Sum of closedPnl in the window (before funding and unrealized PnL).',
};
const tipFor = k => TIPS[String(k).replace(/<[^>]*>/g, '').trim()];
const row = (k, v, title) => { const t = title || tipFor(k); return `<div class="row"${t ? ` data-tip="${esc(t)}"` : ''}><span>${k}</span><b class="num">${v}</b></div>`; };
const win = (S, w) => (S.stats && S.stats.windowedStats && S.stats.windowedStats[w]) || null;
const CARDS = [
  { id: 'summary', title: 'Account', w: 4, render(S) {
    const a = S.account, eq = n(a.equity), dep = n(a.netDeposits), pnl = eq - dep, pr = getPeriod(S);
    const upnl = Object.values(a.positions || {}).reduce((x, p) => x + n(p.unrealizedPnl), 0);
    const pp = pSeries(S, 'pnlHistory'), dEq = pp.length ? pp[pp.length - 1][1] : 0;
    return `<div class="big num">${money(eq)}</div><div class="rows">` +
      row('PnL by account', `<span class="${cls(pnl)}">${smoney(pnl)}</span>`, 'equity − net deposits') +
      row('ROI on deposit', dep > 0 ? `<span class="${cls(pnl)}">${sgn(pnl / dep * 100, 1)}%</span>` : '—') +
      row('Net deposits', money(dep)) + row('Free collateral', money(n(a.freeCollateral))) +
      row('Unrealized PnL', `<span class="${cls(upnl)}">${smoney(upnl)}</span>`, 'sum of unrealizedPnl of open positions at current mark prices') +
      (pr ? row('PnL over period (by equity)', `<span class="${cls(dEq)}">${smoney(dEq)}</span>`, 'change of the PnL curve from /portfolio over the selected period') : '') +
      (n(a.pendingDeposits) ? row('Pending deposits', money(n(a.pendingDeposits))) : '') + (n(a.pendingWithdrawals) ? row('Pending withdrawals', money(n(a.pendingWithdrawals))) : '') +
      row('Active since', S.transfers && S.transfers.length ? dtl(Math.min(...S.transfers.map(x => x.createdAt))) : '—', 'time of the first deposit/transfer') +
      row('Subaccount', S.idx) + `</div>`;
  } },
  { id: 'volume', title: 'Volume & fees', w: 4, render(S) {
    const lv = S.portfolio ? n(S.portfolio.lifetimeVolume) : (S.stats ? n(S.stats.lifetimeVolume) / SC : null);
    const feesAll = S.stats ? n(S.stats.lifetimeFeesPaid) / SC : null, t = S.stats && S.stats.tradingFeeTier;
    const dep = n(S.account.netDeposits), w24 = win(S, '24h'), w7 = win(S, '7d'), w30 = win(S, '30d');
    const rk = S.lb && S.lb.volume, pr = getPeriod(S), F = S.fs;
    if (pr) return `<div class="big num">$${big(F.vol)}</div><div class="rows">` + row('Period', esc(pr.label)) + row('Fills', fmt(F.n, 0)) +
      row('Fees over period', money(F.fees)) + row('Maker / taker (by volume)', `${fmt(F.mvol / (F.vol || 1) * 100, 0)}% / ${fmt(F.tvol / (F.vol || 1) * 100, 0)}%`) +
      row('Average fill size', F.n ? money(F.vol / F.n, 0) : '—') + row('Turnover / deposit', dep > 0 ? fmt(F.vol / dep, 1) + '×' : '—') +
      row('Fee tier', t ? `L${t.level} · maker ${fmt(t.makerFeePpm / 100, 2)} bps · taker ${fmt(t.takerFeePpm / 100, 2)} bps` : '—') +
      row('Volume, all time', lv == null ? '—' : '$' + big(lv)) + rankRows(S) + `</div>` +
      '<p class="note">Arcus ranks only three windows (all time, last 30 days, last 24 hours), so a rank for this specific period is not available from the API.</p>' +
      (S.fillsDone ? '' : '<p class="note">Period fills are still loading…</p>') + (S.fillsCapped ? '<p class="note">Reached the 200,000-fill limit — the period is not fully counted.</p>' : '');
    return `<div class="big num">${lv == null ? '—' : '$' + big(lv)}</div><div class="rows">` +
      row('Last 24h', w24 ? '$' + big(n(w24.volume) / SC) : '—') + row('Last 7d', w7 ? '$' + big(n(w7.volume) / SC) : '—') + row('Last 30d', w30 ? '$' + big(n(w30.volume) / SC) : '—') +
      row('Turnover / deposit', dep > 0 && lv != null ? fmt(lv / dep, 1) + '×' : '—') +
      row('Fees, all time', feesAll == null ? '—' : money(feesAll)) + row('Fees, 24h', w24 ? money(n(w24.feesPaid) / SC) : '—') +
      row('Fee tier', t ? `L${t.level} · maker ${fmt(t.makerFeePpm / 100, 2)} bps · taker ${fmt(t.takerFeePpm / 100, 2)} bps` : '—') +
      rankRows(S) + `</div>`;
  } },
  { id: 'pnl', title: 'Profit', w: 4, render(S) {
    const eqp = n(S.account.equity) - n(S.account.netDeposits), lbe = S.lb && S.lb.pnl && S.lb.pnl.entries && S.lb.pnl.entries[0];
    const real = lbe ? n(lbe.pnl) / SC : null, feesAll = S.stats ? n(S.stats.lifetimeFeesPaid) / SC : null;
    const fund = S.funding ? S.funding.reduce((s, x) => s + n(x.payment), 0) : null, lv = S.portfolio ? n(S.portfolio.lifetimeVolume) : null;
    const pr = getPeriod(S), F = S.fs;
    if (pr) {
      const pf = periodFunding(S), net = F.pnl - F.fees + pf, pp = pSeries(S, 'pnlHistory'), dEq = pp.length ? pp[pp.length - 1][1] : null;
      const oldest = S.funding && S.funding.length ? Math.min(...S.funding.map(x => x.time)) : null;
      return `<div class="big num ${cls(net)}">${smoney(net)}</div><div class="rows">` + row('Period', esc(pr.label)) +
        row('Realized PnL (closedPnl)', `<span class="${cls(F.pnl)}">${smoney(F.pnl)}</span>`) + row('Fees', money(-F.fees)) +
        row('Funding over period', `<span class="${cls(pf)}">${smoney(pf)}</span>`) +
        row('PnL by equity over period', dEq == null ? '—' : `<span class="${cls(dEq)}">${smoney(dEq)}</span>`, 'equity change excluding deposits and withdrawals, from /portfolio') +
        row('PnL per $1M volume', F.vol > 0 ? smoney(net / F.vol * 1e6, 0) : '—') + `</div>` +
        `<p class="note">Big number = realized − fees + funding. “By equity” also includes unrealized PnL and exchange credits.${oldest != null && oldest > pr.from ? ' Funding is not loaded for the whole period (the API returns only the last 1000 payments).' : ''}</p>`;
    }
    return `<div class="big num ${cls(eqp)}">${smoney(eqp)}</div><div class="rows">` +
      row('PnL by account', `<span class="${cls(eqp)}">${smoney(eqp)}</span>`, 'equity − net deposits: includes unrealized PnL, fees, funding and any exchange credits') +
      row('Realized PnL (by fills)', real == null ? '—' : `<span class="${cls(real)}">${smoney(real)}</span>`, 'sum of closedPnl from the Arcus leaderboard; unrealized is not included') +
      row('Fees (all time)', feesAll == null ? '—' : money(-feesAll)) +
      row('Funding (loaded history)', fund == null ? '—' : `<span class="${cls(fund)}">${smoney(fund)}</span>`) +
      row('PnL per $1M volume', lv > 0 ? smoney(eqp / lv * 1e6, 0) : '—') +
      row('PnL rank (all time)', S.lb && S.lb.pnl && S.lb.pnl.entries[0] ? '#' + S.lb.pnl.entries[0].rank : '—') + `</div>` +
      `<p class="note">“By account” and “realized” can differ: they include different things (fees, unrealized PnL, credits).</p>`;
  } },
  { id: 'equity', title: 'Equity', w: 6, ranges: true, render() { return '<div class="chartbox" data-ch="equity"></div>'; },
    after(el, S) { chartSeries(el, S, 'accountEquityHistory', v => money(v, 0), v => money(v, 2), false); } },
  { id: 'pnlchart', title: 'PnL over period', w: 6, ranges: true, render() { return '<div class="chartbox" data-ch="pnl"></div>'; },
    after(el, S) { chartSeries(el, S, 'pnlHistory', v => smoney(v, 0), v => smoney(v, 2), true); } },
  { id: 'risk', title: 'Risk & liquidation', sub: 'now', w: 6, render(S) {
    const R = S.risk, eq = Math.max(R.eq, 1e-6), pm = Math.min(100, R.mm / eq * 100), pi = Math.min(100, R.im / eq * 100);
    const tot = R.long + R.short || 1;
    return `<div class="rows">` + row('Equity', money(R.eq)) + row('Maintenance margin', money(R.mm)) + row('Margin used (initial)', money(R.im)) +
      row('Buffer to liquidation', `<span class="${R.buffer < eq * .3 ? 'neg' : ''}">${money(R.buffer)}</span>${R.gross ? ` · ${fmt(R.buffer / R.gross * 100, 1)}% of gross` : ''}`) +
      row('Gross / leverage', `${money(R.gross, 0)} · ${R.lev == null ? '—' : fmt(R.lev, 2) + '×'}`) + `</div>` +
      `<div class="bar2" title="fill: share of equity used as margin"><span style="width:${pi}%;background:var(--s1);opacity:.35"></span><span style="width:${pm}%;background:var(--s2)"></span></div>
       <div class="legend"><span><i style="background:var(--s2)"></i>maintenance</span><span><i style="background:var(--s1);opacity:.4"></i>initial</span></div>
       <div class="rows" style="margin-top:12px">` + row('Longs', `<span class="pos">${money(R.long, 0)}</span>`) + row('Shorts', `<span class="neg">${money(R.short, 0)}</span>`) + row('Net exposure', `<span class="${cls(R.long - R.short)}">${smoney(R.long - R.short, 0)}</span> · ${fmt((R.long - R.short) / tot * 100, 0)}% of total`) + `</div>
       <div class="bar2"><span style="width:${R.long / tot * 100}%;background:var(--good);opacity:.85"></span><span style="left:${R.long / tot * 100}%;width:${R.short / tot * 100}%;background:var(--bad);opacity:.85"></span></div>`;
  } },
  { id: 'positions', title: 'Open positions', sub: 'now', w: 12, render(S) {
    const R = S.risk; if (!R.rows.length) return '<div class="empty">No open positions</div>';
    const rows = R.rows.slice().sort((a, b) => b.notl - a.notl);
    return `<div class="scroll"><table><thead><tr><th>Market</th><th>Side</th><th>Size $</th><th>Entry</th><th>Mark</th><th>uPnL</th><th>uPnL %</th><th>Leverage</th><th>Margin</th><th>Liq. price</th><th>To liq.</th><th>Funding</th></tr></thead><tbody>` +
      rows.map(({ p, s, mid, notl, liq, dist }) => { const up = n(p.unrealizedPnl), ent = n(p.averageEntryPrice), pc = ent ? (s > 0 ? 1 : -1) * (mid - ent) / ent * 100 : 0;
        return `<tr><td>${esc(p.marketDisplayName)}</td><td><span class="tag ${s > 0 ? 'ok' : 'bad'}">${s > 0 ? '▲ LONG' : '▼ SHORT'}</span></td><td class="num">${money(notl)}</td><td class="num">${pxf(ent)}</td><td class="num">${pxf(mid)}</td><td class="num ${cls(up)}">${smoney(up, 2)}</td><td class="num ${cls(pc)}">${sgn(pc, 2)}%</td><td class="num">${esc(p.leverage)}× ${p.marginMode === 'ISOLATED' ? 'iso' : 'cross'}</td><td class="num">${money(n(p.marginUsed))}</td><td class="num">${liq ? pxf(liq) : '—'}</td><td class="num">${dist == null ? '—' : fmt(dist, 1) + '%'}</td><td class="num ${cls(-n(p.cumulativeFunding && p.cumulativeFunding.allTime))}">${smoney(-n(p.cumulativeFunding && p.cumulativeFunding.allTime), 2)}</td></tr>`; }).join('') + `</tbody></table></div>
      <p class="note">Cross-margin: each liquidation price assumes all other marks stay unchanged; maintenance fractions come from /v1/markets. This is an estimate, not the exchange's formula. Not computed for isolated positions.</p>`;
  } },
  { id: 'activity', title: 'Trading style', sub: fsub, w: 4, render(S) {
    const F = S.fs; if (!S.fills.length) return S.fillsDone ? '<div class="empty">No fills</div>' : '<div class="empty">Loading fills…</div>';
    const span = (F.t1 - F.t0) / 1e6, closed = F.wins + F.losses, pf = F.lossSum ? F.winSum / -F.lossSum : null;
    return `<div class="rows">` + row('Fills', fmt(F.n, 0)) + row('Period', `${dtl(F.t0)} – ${dtl(F.t1)}`) + row('Volume', '$' + big(F.vol)) +
      row('Maker / taker (by volume)', `${fmt(F.mvol / (F.vol || 1) * 100, 0)}% / ${fmt(F.tvol / (F.vol || 1) * 100, 0)}%`) +
      row('Average fill size', money(F.vol / F.n, 0)) + row('Fills per hour', span > 60 ? fmt(F.n / (span / 3600), 1) : '—') +
      row('Win rate (closing fills)', closed ? fmt(F.wins / closed * 100, 1) + '%' : '—') +
      row('Average win / loss', closed ? `${smoney(F.wins ? F.winSum / F.wins : 0, 3)} / ${smoney(F.losses ? F.lossSum / F.losses : 0, 3)}` : '—') +
      row('Profit factor', pf == null ? '—' : fmt(pf, 2)) + row('Best / worst', `${smoney(F.maxWin, 2)} / ${smoney(F.maxLoss, 2)}`) +
      row('Closed PnL − fees', `<span class="${cls(F.pnl - F.fees)}">${smoney(F.pnl - F.fees, 2)}</span>`) +
      row('Buys / sells', `${fmt(F.buyVol / (F.vol || 1) * 100, 0)}% / ${fmt(F.sellVol / (F.vol || 1) * 100, 0)}%`) + `</div>`;
  } },
  { id: 'curve', title: 'Realized PnL curve', sub: S => 'closedPnl − fees · ' + fsub(S), w: 8, render() { return '<div class="chartbox" data-ch="curve"></div>'; },
    after(el, S) { const b = $('[data-ch=curve]', el); if (S.fs.curve.length < 2) { b.innerHTML = '<div class="empty">Need more fills</div>'; return; }
      lineChart(b, S.fs.curve, { color: css('--s1'), zero: true, minRange: 0.5, axis: v => smoney(v, Math.abs(v) < 10 ? 2 : 0), tip: v => smoney(v, 2), xfmt: tshort, tfmt: tshort }); } },
  { id: 'daily', title: 'Volume by day', sub: S => 'UTC · ' + fsub(S), w: 6, render() { return '<div class="chartbox" data-ch="daily"></div>'; },
    after(el, S) { const b = $('[data-ch=daily]', el), items = Object.keys(S.fs.byDay).sort().map(k => ({ label: k.slice(8) + '.' + k.slice(5, 7), v: S.fs.byDay[k].vol, net: S.fs.byDay[k].net }));
      barChart(b, items, { color: css('--s2'), axis: v => '$' + big(v), tip: (v, it) => `$${fmt(v, 0)} · net ${smoney(it.net, 2)}` }); } },
  { id: 'hourly', title: 'Activity by hour', sub: S => 'UTC, volume · ' + fsub(S), w: 6, render() { return '<div class="chartbox" data-ch="hourly"></div>'; },
    after(el, S) { barChart($('[data-ch=hourly]', el), S.fs.byHour.map((v, h) => ({ label: String(h).padStart(2, '0'), v })), { color: css('--s3'), axis: v => '$' + big(v), tip: v => '$' + fmt(v, 0) }); } },
  { id: 'bymarket', title: 'Markets', sub: fsub, w: 12, render(S) {
    const F = S.fs, ks = Object.keys(F.byM); if (!ks.length) return '<div class="empty">No data</div>';
    const rows = ks.map(k => { const m = F.byM[k]; return { k, ...m, net: m.pnl - m.fees, win: (m.wins + m.losses) ? m.wins / (m.wins + m.losses) * 100 : null }; });
    const key = S.sortKey || 'vol', dir = S.sortDir || -1; rows.sort((a, b) => ((a[key] > b[key]) - (a[key] < b[key])) * dir || 0);
    const th = (k, t) => `<th data-sort="${k}">${t}${k === key ? (dir < 0 ? ' ↓' : ' ↑') : ''}</th>`;
    return `<div class="scroll"><table><thead><tr>${th('k', 'Market')}${th('fills', 'Fills')}${th('vol', 'Volume $')}${th('mk', 'Maker %')}${th('pnl', 'Closed PnL')}${th('fees', 'Fees')}${th('net', 'Net')}${th('win', 'Win %')}</tr></thead><tbody>` +
      rows.map(r => `<tr><td>${esc(r.k)}</td><td class="num">${r.fills}</td><td class="num">${fmt(r.vol, 0)}</td><td class="num">${fmt(r.mvol / (r.vol || 1) * 100, 0)}</td><td class="num ${cls(r.pnl)}">${smoney(r.pnl, 2)}</td><td class="num">${fmt(r.fees, 2)}</td><td class="num ${cls(r.net)}">${smoney(r.net, 2)}</td><td class="num">${r.win == null ? '—' : fmt(r.win, 0)}</td></tr>`).join('') + `</tbody></table></div>`;
  } },
  { id: 'category', title: 'Volume by asset class', sub: fsub, w: 4, render(S) {
    const by = {}; let tot = 0;
    for (const f of S.fills) { const v = n(f.size) * n(f.price), c = (S.mk[f.marketId] || {}).category || 'OTHER'; by[c] = (by[c] || 0) + v; tot += v; }
    const rows = Object.entries(by).sort((a, b) => b[1] - a[1]); if (!rows.length) return S.fillsDone ? '<div class="empty">No fills</div>' : '<div class="empty">Loading fills…</div>';
    return `<div class="rows">` + rows.map(([c, v]) => `<div class="hbar"><div class="hbl"><span>${esc(c.toLowerCase())}</span><b class="num">${fmt(v / tot * 100, 1)}% · $${big(v)}</b></div><div class="hbt"><i style="width:${v / tot * 100}%"></i></div></div>`).join('') + `</div>`;
  } },
  { id: 'orderflow', title: 'Order flow', sub: S => S.orders ? `${fmt(S.orders.length, 0)} orders · ${getPeriod(S) ? getPeriod(S).label : 'latest page'}` : '', w: 4, render(S) {
    const o = S.orders; if (!o) return '<div class="empty">Loading orders…</div>'; if (!o.length) return '<div class="empty">No orders</div>';
    const st = {}, tif = {}, life = []; let plac = 0, filled = 0, buy = 0;
    for (const x of o) { st[x.status] = (st[x.status] || 0) + 1; tif[x.timeInForce] = (tif[x.timeInForce] || 0) + 1; const px = n(x.price); plac += n(x.originalSize) * px; filled += n(x.filledSize) * (n(x.avgFillPrice) || px); if (x.status === 'CANCELED') life.push((x.updatedAt - x.createdAt) / 1e6); if (x.side === 'BUY') buy++; }
    life.sort((a, b) => a - b); const med = life.length ? life[life.length >> 1] : null, pc = (k, m) => fmt(k / m * 100, 0) + '%';
    return `<div class="rows">` + Object.entries(st).sort((a, b) => b[1] - a[1]).map(([k, v]) => row(esc(k.toLowerCase().replace(/_/g, ' ')), `${fmt(v, 0)} · ${pc(v, o.length)}`)).join('') +
      row('Filled / placed (by size)', plac ? fmt(filled / plac * 100, 1) + '%' : '—') + row('Avg. order size', '$' + fmt(plac / o.length, 0)) +
      row('Median time to cancel', med == null ? '—' : med < 120 ? fmt(med, 1) + ' s' : dur(med)) +
      row('Time in force', Object.entries(tif).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${pc(v, o.length)}`).join(' · ')) +
      row('Buys / sells', `${pc(buy, o.length)} / ${pc(o.length - buy, o.length)}`) + `</div>` + (o.length >= 1000 ? '<p class="note">The API returns up to 1,000 orders per request, so this is a sample of the latest orders in the selected period.</p>' : '');
  } },
  { id: 'feetier', title: 'Fee tier progress', sub: '30-day volume', w: 4, render(S) {
    const t = S.ex && S.ex.tiers, st = S.stats; if (!st) return '<div class="empty">No data</div>'; if (!t) return '<div class="empty">Loading…</div>';
    const v30 = n(st.rollingVolume) / SC, cur = st.tradingFeeTier ? st.tradingFeeTier.level : 0, tiers = t.tiers || [], ct = tiers.find(x => x.level === cur) || {}, nx = tiers.find(x => x.level === cur + 1), th = x => x.volume_threshold / SC, bp = p => fmt(p / 100, 2);
    const pct = nx ? Math.min(100, v30 / th(nx) * 100) : 100;
    return `<div class="big">${esc(ct.name || 'L' + cur)} <span class="muted" style="font-size:16px">level ${cur}</span></div><div class="rows">` +
      row('30-day volume', '$' + big(v30)) + row('Maker / taker fee', `${bp(ct.maker_fee_ppm || 0)} / ${bp(ct.taker_fee_ppm || 0)} bps`) +
      (nx ? row(`Next: ${esc(nx.name)}`, `$${big(th(nx))} · taker ${bp(nx.taker_fee_ppm)} bps`) + row('Volume to next tier', '$' + big(Math.max(0, th(nx) - v30))) : row('Next tier', 'highest tier reached')) + `</div>` +
      `<div class="bar2" title="progress to the next tier"><span style="width:${pct}%;background:var(--s3)"></span></div>` +
      `<div class="scroll" style="max-height:200px;margin-top:8px"><table><thead><tr><th>Tier</th><th>30d volume ≥</th><th>Maker</th><th>Taker</th></tr></thead><tbody>` +
      tiers.map(x => `<tr${x.level === cur ? ' style="background:var(--surface-2)"' : ''}><td>${x.level === cur ? '▶ ' : ''}${esc(x.name)}</td><td class="num">${x.volume_threshold ? '$' + big(th(x)) : '—'}</td><td class="num">${bp(x.maker_fee_ppm)}</td><td class="num">${bp(x.taker_fee_ppm)}</td></tr>`).join('') + `</tbody></table></div><p class="note">Fees in bps; negative = rebate. Tier is based on rolling 30-day volume.</p>`;
  } },
  { id: 'standing', title: 'Leaderboard standing', sub: 'Arcus windows: all time · 30d · 24h', w: 8, render(S) {
    const x = S.ex && S.ex.lbx; if (!x) return '<div class="empty">Loading…</div>';
    const ok = v => v != null && isFinite(v) && Math.abs(v) < 9e18, e0 = (g, k) => g && g[k] && g[k].entries && g[k].entries[0];
    const vr = (S.lb && S.lb.vr) || {}, rk = v => v == null ? '—' : '#' + fmt(v, 0);
    const rows = [['all', 'All time', 'all'], ['30d', 'Last 30 days', 'd30'], ['24h', 'Last 24 hours', 'h24']].map(([w, lab, vk]) => {
      const g = x[w] || {}, ep = e0(g, 'pnl'), ef = e0(g, 'fees'), vol = ep ? n(ep.volume) / SC : (ef ? n(ef.volume) / SC : null);
      const pnl = ep && ok(n(ep.pnl)) ? n(ep.pnl) / SC : null, fee = ef && ok(n(ef.feesPaid)) ? n(ef.feesPaid) / SC : (ep && ok(n(ep.feesPaid)) ? n(ep.feesPaid) / SC : null);
      return `<tr><td>${lab}</td><td class="num">${vol == null ? '—' : '$' + big(vol)}</td><td class="num">${rk(vr[vk])}</td><td class="num ${cls(pnl)}">${pnl == null ? '—' : smoney(pnl, 2)}</td><td class="num">${ep ? rk(ep.rank) : '—'}</td><td class="num">${fee == null ? '—' : money(fee)}</td><td class="num">${ef ? rk(ef.rank) : '—'}</td></tr>`;
    }).join('');
    return `<div class="scroll" style="max-height:none"><table><thead><tr><th>Window</th><th>Volume</th><th>Vol. rank</th><th>Realized PnL</th><th>PnL rank</th><th>Fees paid</th><th>Fee rank</th></tr></thead><tbody>${rows}</tbody></table></div>` +
      `<p class="note">Ranks are among all Arcus traders. Arcus offers only these three windows, so a weekly rank is not available. Realized PnL here is the exchange's closedPnl sum (before funding and unrealized). Rows are empty if the address did not trade in the window.</p>`;
  } },
  { id: 'limits', title: 'Limits & margin settings', w: 4, render(S) {
    if (!S.ex) return '<div class="empty">Loading…</div>';
    const lv = S.ex.lev && S.ex.lev.leverages, rl = S.ex.rl, pool = (name, p) => p ? row(name, `${fmt(n(p.used), 0)} / ${fmt(n(p.cap), 0)} · ${fmt(n(p.used) / (n(p.cap) || 1) * 100, 2)}%`) : '';
    let h = '<div class="rows">';
    if (lv && lv.length) { const cross = lv.filter(x => !x.isolated).length, hi = lv.reduce((a, b) => b.leverage > a.leverage ? b : a), lo = lv.reduce((a, b) => b.leverage < a.leverage ? b : a);
      h += row('Markets with leverage set', fmt(lv.length, 0)) + row('Cross / isolated', `${cross} / ${lv.length - cross}`) + row('Highest leverage set', `${hi.leverage}× ${esc(hi.marketDisplayName)}`) + row('Lowest leverage set', `${lo.leverage}× ${esc(lo.marketDisplayName)}`) + row('Average leverage set', fmt(lv.reduce((a, x) => a + n(x.leverage), 0) / lv.length, 1) + '×'); }
    h += pool('Order rate-limit pool (used / cap)', rl && rl.order) + pool('Cancel rate-limit pool (used / cap)', rl && rl.cancel) + '</div>';
    return h + '<p class="note">Leverage is the per-market setting, not what is currently used. Rate-limit pool caps grow with realized trading volume.</p>';
  } },
  { id: 'funding', title: 'Funding', w: 4, render(S) {
    const pr = getPeriod(S), f = S.funding && S.funding.filter(x => inP(pr, x.time)); if (!f) return '<div class="empty">No data</div>'; if (!f.length) return '<div class="empty">No payments</div>';
    const tot = f.reduce((s, x) => s + n(x.payment), 0), by = {}; f.forEach(x => by[x.marketDisplayName] = (by[x.marketDisplayName] || 0) + n(x.payment));
    const top = Object.entries(by).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6);
    return `<div class="big num ${cls(tot)}">${smoney(tot, 2)}</div><div class="rows">` + top.map(([k, v]) => row(esc(k), `<span class="${cls(v)}">${smoney(v, 3)}</span>`)).join('') + row('Received', `<span class="pos">${smoney(f.filter(x => n(x.payment) > 0).reduce((a, x) => a + n(x.payment), 0), 2)}</span>`) + row('Paid', `<span class="neg">${smoney(f.filter(x => n(x.payment) < 0).reduce((a, x) => a + n(x.payment), 0), 2)}</span>`) + `</div><p class="note">Latest ${f.length} payments (+ received, − paid).</p>`;
  } },
  { id: 'transfers', title: 'Deposits & withdrawals', w: 4, render(S) {
    const pr = getPeriod(S), t = S.transfers && S.transfers.filter(x => inP(pr, x.createdAt)); if (!t) return '<div class="empty">No data</div>'; if (!t.length) return '<div class="empty">No transfers</div>';
    const net = t.filter(x => x.status === 'APPLIED').reduce((s, x) => s + (x.type === 'DEPOSIT' ? 1 : x.type === 'WITHDRAWAL' ? -1 : 0) * n(x.amount), 0);
    return `<div class="big num">${smoney(net, 2)}</div><div class="rows">` + t.slice(0, 8).map(x => row(`${dtl(x.createdAt)} <span class="tag ${x.type === 'DEPOSIT' ? 'ok' : x.type === 'WITHDRAWAL' ? 'bad' : ''}">${esc(x.type.toLowerCase())}</span>`, `${x.type === 'WITHDRAWAL' ? '−' : '+'}${money(n(x.amount))}`)).join('') + `</div><p class="note">${t.length > 8 ? 'Showing the latest 8 of ' + t.length + '. ' : ''}Net of applied transfers.</p>`;
  } },
  { id: 'orders', title: 'Open orders', sub: 'now', w: 6, render(S) {
    const o = S.openOrders || []; if (!o.length) return '<div class="empty">No open orders</div>';
    const by = {}; o.forEach(x => by[x.marketDisplayName] = (by[x.marketDisplayName] || 0) + 1);
    return `<div class="rows">` + row('Total', fmt(o.length, 0)) + row('Markets', Object.keys(by).length) + row('Buys / sells', `${o.filter(x => x.side === 'BUY').length} / ${o.filter(x => x.side === 'SELL').length}`) +
      row('Resting buy notional', money(o.filter(x => x.side === 'BUY').reduce((a, x) => a + n(x.price) * n(x.remainingSize), 0), 0)) + row('Resting sell notional', money(o.filter(x => x.side === 'SELL').reduce((a, x) => a + n(x.price) * n(x.remainingSize), 0), 0)) + `</div>` +
      `<div class="scroll" style="margin-top:8px;max-height:260px"><table><thead><tr><th>Market</th><th>Side</th><th>Price</th><th>Remaining</th><th>TIF</th><th>Created</th></tr></thead><tbody>` +
      o.slice(0, 60).map(x => `<tr><td>${esc(x.marketDisplayName)}</td><td><span class="${x.side === 'BUY' ? 'pos' : 'neg'}">${x.side === 'BUY' ? '▲ BUY' : '▼ SELL'}</span></td><td class="num">${pxf(n(x.price))}</td><td class="num">${fmt(n(x.remainingSize), 4)}</td><td>${esc(x.timeInForce)}</td><td class="num">${dt(x.createdAt)}</td></tr>`).join('') + `</tbody></table></div>`;
  } },
  { id: 'fills', title: 'Recent fills', sub: fsub, w: 6, render(S) {
    if (!S.fills.length) return '<div class="empty">No fills</div>';
    return `<div class="scroll"><table><thead><tr><th>Time</th><th>Market</th><th>Side</th><th>Price</th><th>$</th><th>Role</th><th>PnL</th></tr></thead><tbody>` +
      S.fills.slice(0, 60).map(f => { const v = n(f.size) * n(f.price), p = n(f.closedPnl) - n(f.fee); return `<tr><td class="num">${dt(f.createdAt)}</td><td>${esc(f.marketDisplayName)}</td><td><span class="${f.side === 'BUY' ? 'pos' : 'neg'}">${f.side === 'BUY' ? '▲ BUY' : '▼ SELL'}</span></td><td class="num">${pxf(n(f.price))}</td><td class="num">${fmt(v, 1)}</td><td><span class="tag ${f.role === 'MAKER' ? 'ok' : 'warn'}">${f.role.toLowerCase()}</span></td><td class="num ${cls(p)}">${n(f.closedPnl) || n(f.fee) ? smoney(p, 3) : '—'}</td></tr>`; }).join('') + `</tbody></table></div>`;
  } },
  { id: 'season', title: 'Season & points', w: 4, render(S) {
    const m = S.meta; if (!m) return '<div class="empty">No data</div>';
    const st = seasonStart(S), lw = m.latest_week && Date.parse(m.latest_week.distributed_at);
    const dropped = lw ? Math.max(0, Math.floor((lw - st) / WEEK)) : 0, total = n(m.season_total_points);
    const cur = weeksList(S).slice(-1)[0], nd = m.next_drop_at ? Math.max(0, (Date.parse(m.next_drop_at) - Date.now()) / 1000) : null;
    return `<div class="big num">${fmt(total, 0)}</div><div class="rows" style="margin-top:6px">` +
      row('Total points distributed', fmt(total, 0), 'sum of all participants\' season points = everything distributed so far') +
      row('Season', esc(m.season.name)) +
      row('Current week', cur ? `Week ${cur.n} (in progress)` : '—', 'weeks counted from the season start, 7 days each') +
      row('Weeks distributed', fmt(dropped, 0)) +
      row('Average per week', dropped ? fmt(total / dropped, 0) : '—') +
      row('Participants', fmt(m.season_addresses, 0)) +
      row('Last drop (local time)', lw ? dtl(lw * 1000) : '—') +
      row('Next drop', nd == null ? '—' : `in ${dur(nd)}`) + `</div>` +
      (S.top ? `<div class="rows" style="margin-top:10px"><div class="row"><span><b>Top 3 this season</b></span><span></span></div>` + S.top.map(e => row(`#${e.rank} ${esc(e.name)} <span class="tag">${esc(e.tier)}</span>`, fmt(e.points, 0))).join('') + `</div>` : '') +
      `<p class="note">Arcus only returns a specific wallet's points to its owner after sign-in, so they are not shown here.</p>`;
  } },
];
const TITLES = Object.fromEntries(CARDS.map(c => [c.id, c.title]));

function chartSeries(el, S, key, axis, tip, zero) {
  const b = $('[data-ch]', el); if (!S.portfolio) { b.innerHTML = '<div class="empty">No data</div>'; return; }
  const pts = pSeries(S, key), pr = getPeriod(S);
  lineChart(b, pts, { color: css(zero ? '--s2' : '--s1'), zero, minRange: 1, area: !zero, axis, tip, xfmt: !pr && range !== 'day' ? dshort : tshort, tfmt: tshort });
  const old = el.querySelector('.negnote'); if (old) old.remove();
  if (!zero && pts.some(p => p[1] < 0)) b.insertAdjacentHTML('afterend', '<p class="note negnote">The equity history returned by the exchange contains negative points — these values come from the Arcus API, a data glitch is possible.</p>');
}

/* ---------------------------------------------------------------- render */
function cardsHTML(S, list, pr) {
  const ro = Object.fromEntries([['day', '24h'], ['week', '7d'], ['month', '30d'], ['all', 'all']]);
  const addr = S.addr;
  return `<div class="hdr"><code class="addr">${esc(addr)}</code><span class="tag">subaccount ${S.idx}</span><span class="tag ${pr ? 'warn' : ''}">${pr ? esc(pr.label) : 'all time'}</span><span class="muted" id="upd"></span></div>` + list.map(c =>
    `<section class="card w${c.w}" data-card="${c.id}"><h2>${c.title}${c.sub ? `<span class="sub">${typeof c.sub === 'function' ? c.sub(S) : c.sub}</span>` : ''}${c.ranges && !pr ? `<span class="seg">${Object.entries(ro).map(([k, t]) => `<button data-range="${k}" class="${k === range ? 'on' : ''}">${t}</button>`).join('')}</span>` : ''}</h2>${c.render(S)}</section>`).join('');
}
function drawAll(out, list) { list.forEach(c => { if (c.after) { try { c.after($(`[data-card=${c.id}]`, out), S); } catch (e) { console.error(c.id, e); } } }); }
function prepare() { S.risk = riskCalc(S.account, S.mk); S.fs = fillStats(S.fills); }
function render() {
  if (!S) return;
  prepare();
  const out = $('#out'), list = CARDS.filter(c => enabled.has(c.id)), pr = getPeriod(S);
  out.innerHTML = cardsHTML(S, list, pr);
  const draw = () => drawAll(out, list);
  draw(); cancelAnimationFrame(render.raf); render.raf = requestAnimationFrame(() => { const w = out.clientWidth; if (w !== render.w) { render.w = w; draw(); } });
  out.querySelectorAll('th').forEach(th => { const t = tipFor(th.textContent.replace(/[\s↓↑]+$/, '')); if (t) th.title = t; });
  $('#upd').textContent = 'updated ' + new Date().toLocaleTimeString('en-US', { hour12: false });
  $('#welcome').hidden = true;
}

/* ---------------------------------------------------------------- loading */
function status(html, err) { const s = $('#status'); s.className = 'status' + (err ? ' err' : '') + (/^Loading/.test(html) ? ' busy' : ''); s.innerHTML = (/^Loading/.test(html) ? '<i class="spin"></i>' : '') + html; }
async function loadMarkets() { if (loadMarkets.c) return loadMarkets.c; const d = await get(API, '/markets', {}, 20); const arr = Array.isArray(d) ? d : Object.values(d.markets || d); loadMarkets.c = Object.fromEntries(arr.map(m => [m.marketId, m])); return loadMarkets.c; }

async function loadWallet(addr, idx, opts = {}) {
  const my = ++runId; addr = addr.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) { status('Invalid address: expected 0x followed by 40 hex characters', true); return; }
  if (!opts.silent) { status('Loading wallet data…'); S = null; $('#out').innerHTML = ''; }
  const q = { address: addr, accountIndex: idx };
  const safe = p => p.catch(e => (e.status === 404 ? null : (console.warn(e), null)));
  let account;
  try { account = await get(API, '/account', q, 2); } catch (e) {
    if (e.status === 404) { status('No activity on Arcus for this address and subaccount. Check the address or pick another subaccount.', true); return; }
    if (e.status === 403 || /whitelist/i.test(e.message)) { status('Arcus does not serve data for this address: it is not on the exchange access whitelist. This usually means the wallet is not registered on Arcus, or it is not the right address. Check the address.', true); return; }
    status('Error: ' + esc(e.message), true); return;
  }
  if (my !== runId) return;
  const [mk, stats, portfolio, lbv, lbp, transfers, funding, orders, meta, top, lb30, lb24] = await Promise.all([
    loadMarkets().catch(() => ({})), safe(get(API, '/account/stats', { address: addr, windows: '24h,7d,30d' }, 20)), safe(get(API, '/portfolio', q, 20)),
    safe(get(API, '/leaderboard', { address: addr, window: 'all', sortBy: 'volume' }, 20)), safe(get(API, '/leaderboard', { address: addr, window: 'all', sortBy: 'pnl' }, 20)),
    safe(get(API, '/accountTransferUpdates', q, 20)), safe(get(API, '/funding', { ...q, limit: 1000 }, 20)), safe(get(API, '/openOrders', q, 20)),
    safe(get(PTS, '/meta', {}, 1)), safe(get(PTS, '/leaderboard', { limit: 3 }, 1)),
    safe(get(API, '/leaderboard', { address: addr, window: '30d', sortBy: 'volume' }, 20)), safe(get(API, '/leaderboard', { address: addr, window: '24h', sortBy: 'volume' }, 20))]);
  if (my !== runId) return;
  const keepFills = opts.keep ? S.fills : [];
  S = { addr, idx, account, mk, stats, portfolio, lb: { volume: lbv && lbv.entries && lbv.entries[0] ? { rank: lbv.entries[0].rank } : null, pnl: lbp,
      vr: { all: lbv && lbv.entries && lbv.entries[0] ? lbv.entries[0].rank : null, d30: lb30 && lb30.entries && lb30.entries[0] ? lb30.entries[0].rank : null, h24: lb24 && lb24.entries && lb24.entries[0] ? lb24.entries[0].rank : null } }, transfers: transfers && transfers.accountTransferUpdates,
    funding: funding && funding.fundingPayments, openOrders: orders && orders.orders, meta, top: top && top.entries, fills: keepFills, fillsDone: false, sortKey: S && S.sortKey, sortDir: S && S.sortDir };
  location.hash = addr + (idx ? ':' + idx : '');
  rememberWallet(addr);
  renderPeriodBar();
  render();
  if (!opts.silent) probeSubaccounts(addr, idx);
  loadFills(my, opts.keep);
  loadExtras(my); loadOrders(my);
}
async function loadExtras(my) {
  const addr = S.addr, q = { address: addr, accountIndex: S.idx }, safe = p => p.catch(() => null), calls = [];
  for (const w of ['all', '30d', '24h']) for (const sb of ['pnl', 'fees']) calls.push(safe(get(API, '/leaderboard', { address: addr, window: w, sortBy: sb }, 20)).then(r => [w, sb, r]));
  const [tiers, lev, rl, lbs] = await Promise.all([safe(get(API, '/feetiers', {}, 2)), safe(get(API, '/leverages', q, 20)), safe(get(API, '/rateLimit', q, 2)), Promise.all(calls)]);
  if (my !== runId || !S || S.addr !== addr) return;
  const lbx = {}; lbs.forEach(([w, sb, r]) => { (lbx[w] = lbx[w] || {})[sb] = r; });
  S.ex = { tiers, lev, rl, lbx }; render();
}
async function loadOrders(my) {
  const pr = getPeriod(S); S.orders = null;
  try {
    const d = await get(API, '/orders', { address: S.addr, accountIndex: S.idx, limit: 1000, from: pr ? pr.from : null, to: pr ? pr.to : null }, 20);
    if (my !== runId) return; S.orders = d.orders || [];
  } catch (e) { if (my !== runId) return; S.orders = []; }
  render();
}
let fillSeq = 0;
async function loadFills(my, incremental) {
  const seq = ++fillSeq, pr = getPeriod(S), CAP = 200000, depth = pr ? CAP : parseInt($('#depth').value, 10), seen = new Set(S.fills.map(f => f.tradeId));
  let to = pr ? pr.to : null, from = pr ? pr.from : null;
  if (incremental && S.fills.length) from = Math.max(...S.fills.map(f => f.createdAt)) + 1; else { S.fills = []; seen.clear(); }
  S.fillsCapped = false; S.fillsDone = false;
  const live = () => my === runId && seq === fillSeq;
  try {
    for (;;) {
      const page = await get(API, '/fills', { address: S.addr, accountIndex: S.idx, limit: 1000, to, from }, 20);
      if (!live()) return;
      const fs = page.fills || []; for (const f of fs) if (!seen.has(f.tradeId)) { seen.add(f.tradeId); S.fills.push(f); }
      S.fills.sort((a, b) => b.createdAt - a.createdAt);
      if (fs.length < 1000 || incremental) break;
      if (S.fills.length >= depth) { S.fillsCapped = !!pr; break; }
      to = fs[fs.length - 1].createdAt - 1;
      status(`Loading fills${pr ? ' of period' : ''}: ${fmt(S.fills.length, 0)}${pr ? '' : ' of ' + fmt(depth, 0)}<span class="bar"><i style="width:${pr ? 60 : Math.min(100, S.fills.length / depth * 100)}%"></i></span>`);
      render();
    }
  } catch (e) { if (live()) { status('Fills loaded only partially: ' + esc(e.message) + ' — pick a smaller number in the “Fills” menu or try again.', true); S.fillsDone = true; render(); } return; }
  if (!live()) return;
  S.fillsDone = true; render();
  const capped = !pr && S.fills.length >= depth, more = [...$('#depth').options].map(o => +o.value).find(v => v > depth);
  status(capped ? `Analyzed the most recent ${fmt(S.fills.length, 0)} fills — older history exists. ${more ? `<button class="linkbtn" id="moreBtn" type="button">Analyze up to ${fmt(more, 0)}</button> or ` : 'This is the maximum depth. '}${more ? 'pick a larger number in the “Fills” menu above to include more.' : ''}`
    : `Done. Fills analyzed: ${fmt(S.fills.length, 0)}${pr ? ' for period “' + esc(pr.label) + '”' : ' (full history)'}.`);
}
async function probeSubaccounts(addr, cur) {
  const sel = $('#sub'), found = [];
  for (let i = 0; i < 10; i++) { if (i === cur) { found.push(i); continue; } try { await get(API, '/account', { address: addr, accountIndex: i }, 2); found.push(i); } catch (e) { } }
  if (S && S.addr === addr) { sel.innerHTML = found.map(i => `<option value="${i}" ${i === cur ? 'selected' : ''}>subaccount ${i}</option>`).join(''); }
}

/* ---------------------------------------------------------------- UI wiring */
function rememberWallet(a) { const r = [a, ...store.get('recent', []).filter(x => x !== a)].slice(0, 5); store.set('recent', r); renderRecent(); }
function renderRecent() { const r = store.get('recent', []); $('#recent').innerHTML = r.map(a => `<button class="chip" data-a="${a}">${a.slice(0, 6)}…${a.slice(-4)}</button>`).join(''); }
$('#recent').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { $('#addr').value = b.dataset.a; $('#sub').value = '0'; loadWallet(b.dataset.a, 0); } });
$('#form').addEventListener('submit', e => { e.preventDefault(); const a = $('#addr').value.trim(); loadWallet(a, a.toLowerCase() === (S && S.addr) ? parseInt($('#sub').value, 10) : 0); });
$('#sub').addEventListener('change', () => loadWallet($('#addr').value.trim(), parseInt($('#sub').value, 10)));
$('#out').addEventListener('click', e => {
  const r = e.target.closest('[data-range]'); if (r) { range = r.dataset.range; store.set('range', range); render(); return; }
  const th = e.target.closest('th[data-sort]'); if (th && S) { const k = th.dataset.sort; S.sortDir = S.sortKey === k ? -(S.sortDir || -1) : (k === 'k' ? 1 : -1); S.sortKey = k; render(); }
});
function renderCardsList() { $('#cardsList').innerHTML = CARDS.map(c => `<label class="chk"><input type="checkbox" data-c="${c.id}" ${enabled.has(c.id) ? 'checked' : ''}> ${c.title}</label>`).join(''); }
$('#cardsList').addEventListener('change', e => { const c = e.target.dataset.c; if (!c) return; e.target.checked ? enabled.add(c) : enabled.delete(c); store.set('cards', [...enabled]); render(); });
$('#cardsAll').onclick = () => { enabled = new Set(CARDS.map(c => c.id)); store.set('cards', [...enabled]); renderCardsList(); render(); };
$('#cardsNone').onclick = () => { enabled = new Set(); store.set('cards', []); renderCardsList(); render(); };
$('#cardsReset').onclick = () => { enabled = new Set(DEFAULT_CARDS); store.set('cards', [...enabled]); renderCardsList(); render(); };
$('#btnCards').onclick = () => { const p = $('#cardsPanel'); p.hidden = !p.hidden; $('#btnCards').setAttribute('aria-expanded', String(!p.hidden)); };
$('#depth').value = String(store.get('depth', 5000)); if (!$('#depth').value) $('#depth').value = '5000';
$('#depth').onchange = () => { store.set('depth', parseInt($('#depth').value, 10)); if (S) loadFills(runId, false); };
$('#status').addEventListener('click', e => { if (e.target.id !== 'moreBtn') return; const cur = +$('#depth').value, nx = [...$('#depth').options].map(o => +o.value).find(v => v > cur); if (nx) { $('#depth').value = String(nx); store.set('depth', nx); if (S) loadFills(runId, false); } });
$('#auto').checked = false;   // off by default, not remembered between visits
function setAuto() { clearInterval(autoTimer); if ($('#auto').checked) autoTimer = setInterval(() => { if (S && !document.hidden) loadWallet(S.addr, S.idx, { silent: true, keep: true }); }, 60000); }
$('#auto').onchange = () => setAuto();
const root = document.documentElement; { const t = store.get('theme', null); if (t) root.dataset.theme = t; }
$('#btnTheme').onclick = () => { const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; root.dataset.theme = dark ? 'light' : 'dark'; store.set('theme', root.dataset.theme); render(); };
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 150); });
/* ---- period bar */
function renderPeriodBar() {
  const w = weeksList(S), bar = $('#periodbar'), k = period.key, fmtD = ms => new Date(ms).toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  const btn = (key, label, small) => `<button class="pbtn ${k === key ? 'on' : ''}" data-p="${key}">${label}${small ? `<small>${small}</small>` : ''}</button>`;
  bar.innerHTML = btn('total', 'All time') + w.filter(x => !x.cur).map(x => btn('w' + x.n, 'Week ' + x.n, fmtD(x.from) + '–' + fmtD(x.end))).join('') +
    (w.length ? btn('cur', 'Current', w[w.length - 1].cur ? 'wk ' + w[w.length - 1].n : '') : '') + btn('custom', 'Custom range…') +
    `<span class="pdesc" title="Week 1 = 30 Sep – 6 Oct, Week 2 = 7 – 13 Oct, and so on (Wednesday 00:00 GMT to Tuesday 23:59 GMT). Not officially confirmed by the Arcus team.">ⓘ weeks: Wed–Tue, 00:00 GMT</span>`;
  $('#custom').hidden = k !== 'custom'; $('#pnote').textContent = 'Weeks are counted from Wednesday 00:00 GMT (UTC) to the next Tuesday 23:59 GMT. This schedule is our assumption: the Arcus team has not officially confirmed that the weekly snapshot is taken at this time.';
}
const toGmtInput = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const parseGmt = v => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(v.trim()); if (!m) return NaN; return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)); };
function applyPeriod(p) {
  period = p; renderPeriodBar();
  if (!S) return; S.fills = []; S.fillsDone = false; render(); loadFills(runId, false); loadOrders(runId);
}
$('#periodbar').addEventListener('click', e => {
  const b = e.target.closest('[data-p]'); if (!b) return; const key = b.dataset.p;
  if (key === 'custom') { const now = Date.now(); if (!period.from) { $('#pf').value = toGmtInput(now - 86400e3); $('#pt').value = toGmtInput(now); } period = { ...period, key: 'custom' }; renderPeriodBar(); if (period.from && period.to) applyPeriod(period); return; }
  applyPeriod({ key });
});
$('#pgo').onclick = () => { const f = parseGmt($('#pf').value), t = parseGmt($('#pt').value); if (isNaN(f) || isNaN(t)) { status('Use the format YYYY-MM-DD HH:MM (GMT), e.g. 2026-10-07 00:00', true); return; } if (!(f < t)) { status('Range start must be before its end', true); return; } applyPeriod({ key: 'custom', from: f, to: t }); };

/* ---------------------------------------------------------------- Share card (canvas, for Discord) */
const SH = { week: null, tok: 0, cache: {}, data: null, w: null, brand: null, size: 720,   // the only output format: 720 x 486 px
   name: store.get('sh_name', ''), bg: null, dim: Math.max(0, Math.min(85, +store.get('sh_dim', 55))), slots: store.get('sh_slots', null) };
// The logo is embedded as a data URI: an image loaded from a file next to the page taints the canvas when the page is opened from disk (file://),
// which makes canvas.toBlob() fail ("Tainted canvases may not be exported").
const ARCUS_LOGO = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTQ0IiBoZWlnaHQ9IjE0NCIgdmlld0JveD0iMCAwIDE0NCAxNDQiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0xNC4yMDcgNjIuODAzMkMxNC4yMDcgNjAuMTg1IDE2LjMyOTUgNTguMDYyNSAxOC45NDc4IDU4LjA2MjVINTguNjY4OUM2NS4wMDQyIDU4LjA2MjUgNjguMTc3IDY1LjcyMjIgNjMuNjk3MiA3MC4yMDE5TDIyLjMgMTExLjU5OUMxOS4zMTM1IDExNC41ODYgMTQuMjA3IDExMi40NzEgMTQuMjA3IDEwOC4yNDdWNjIuODAzMloiIGZpbGw9IiNFRERGQkUiLz4KPHBhdGggZD0iTTg2LjUzNTIgMTI0LjQ0N0M4Ni41MzUyIDEyNy4wNjUgODQuNDEyNyAxMjkuMTg3IDgxLjc5NDQgMTI5LjE4N0wzNi4zNTA3IDEyOS4xODdDMzIuMTI3MSAxMjkuMTg3IDMwLjAxMiAxMjQuMDgxIDMyLjk5ODUgMTIxLjA5NUw3NC4zOTU3IDc5LjY5NzNDNzguODc1NSA3NS4yMTc2IDg2LjUzNTIgNzguMzkwMyA4Ni41MzUyIDg0LjcyNTZMODYuNTM1MiAxMjQuNDQ3WiIgZmlsbD0iI0VEREZCRSIvPgo8cGF0aCBkPSJNMTQuNzAwNSAxNy44NDY2QzE0LjcwMDUgMTUuOTM3OSAxNi4yNDc4IDE0LjM5MDYgMTguMTU2NSAxNC4zOTA2SDY5LjAzNjFDMTAyLjQzOCAxNC4zOTA2IDEyOS41MTYgNDEuNDY4NCAxMjkuNTE2IDc0Ljg3MDZWMTI1Ljk5MUMxMjkuNTE2IDEyNy44OTkgMTI3Ljk2OSAxMjkuNDQ3IDEyNi4wNiAxMjkuNDQ3SDEwNC4xQzEwMi4xOTEgMTI5LjQ0NyAxMDAuNjQ0IDEyNy44OTkgMTAwLjY0NCAxMjUuOTkxVjc5LjczMzNDMTAwLjY0NCA1OS4zNzM5IDg0LjEzOTUgNDIuODY5MyA2My43ODAxIDQyLjg2OTNIMTguMTU2NUMxNi4yNDc4IDQyLjg2OTMgMTQuNzAwNSA0MS4zMjIgMTQuNzAwNSAzOS40MTMzVjE3Ljg0NjZaIiBmaWxsPSIjRURERkJFIi8+CjxwYXRoIGQ9Ik0xNC4yMDcgNjIuODA1MkMxNC4yMDcgNjAuMTg3IDE2LjMyOTUgNTguMDY0NSAxOC45NDc4IDU4LjA2NDVINTguNjY4OUM2NS4wMDQyIDU4LjA2NDUgNjguMTc3IDY1LjcyNDIgNjMuNjk3MiA3MC4yMDM5TDIyLjMgMTExLjYwMUMxOS4zMTM1IDExNC41ODggMTQuMjA3IDExMi40NzIgMTQuMjA3IDEwOC4yNDlWNjIuODA1MloiIGZpbGw9IiNFRERGQkUiLz4KPHBhdGggZD0iTTg2LjUwNTQgMTI0LjQzNEM4Ni41MDU0IDEyNy4wNTIgODQuMzgyOSAxMjkuMTc1IDgxLjc2NDcgMTI5LjE3NUgzNi4zMjA5QzMyLjA5NzQgMTI5LjE3NSAyOS45ODIyIDEyNC4wNjkgMzIuOTY4NyAxMjEuMDgyTDc0LjM2NiA3OS42ODQ4Qzc4Ljg0NTcgNzUuMjA1IDg2LjUwNTQgNzguMzc3OCA4Ni41MDU0IDg0LjcxMzFMODYuNTA1NCAxMjQuNDM0WiIgZmlsbD0iI0VEREZCRSIvPgo8cGF0aCBkPSJNMTQuNzAwNSAxNy44NDY2QzE0LjcwMDUgMTUuOTM3OSAxNi4yNDc4IDE0LjM5MDYgMTguMTU2NSAxNC4zOTA2SDY5LjAzNkMxMDIuNDM4IDE0LjM5MDYgMTI5LjUxNiA0MS40Njg0IDEyOS41MTYgNzQuODcwNlYxMjUuOTkxQzEyOS41MTYgMTI3Ljg5OSAxMjcuOTY5IDEyOS40NDcgMTI2LjA2IDEyOS40NDdIMTA0LjFDMTAyLjE5MSAxMjkuNDQ3IDEwMC42NDQgMTI3Ljg5OSAxMDAuNjQ0IDEyNS45OTFWNzkuNzMzM0MxMDAuNjQ0IDU5LjM3MzkgODQuMTM5NSA0Mi44NjkzIDYzLjc4MDEgNDIuODY5M0gxOC4xNTY1QzE2LjI0NzggNDIuODY5MyAxNC43MDA1IDQxLjMyMiAxNC43MDA1IDM5LjQxMzNWMTcuODQ2NloiIGZpbGw9IiNFRERGQkUiLz4KPC9zdmc+Cg==';
{ const im = new Image(); im.onload = () => { SH.brand = im; try { shRedraw(); } catch (e) { } }; im.src = ARCUS_LOGO; }
store.set('sh_logo', null);   // the logo upload was removed; free the stored data
{ const b = store.get('sh_bg', null); if (b) { const im = new Image(); im.onload = () => { SH.bg = im; }; im.src = b; } }
const shKey = () => `sh_${S.addr}_${SH.week}`;
async function fetchRange(fromUs, toUs, tok) {
  const out = []; let to = toUs;
  for (;;) {
    const page = await get(API, '/fills', { address: S.addr, accountIndex: S.idx, limit: 1000, from: fromUs, to }, 20);
    const fs = page.fills || []; out.push(...fs);
    if (tok !== SH.tok) return null;
    if (fs.length < 1000 || out.length >= 100000) break;
    to = fs[fs.length - 1].createdAt - 1;
  }
  return out;
}
function pnlDelta(fromUs, toUs) {
  const P = S.portfolio; if (!P) return null;
  const name = (Date.now() * 1000 - fromUs) / 864e8 <= 29 ? 'totalMonth' : 'totalAll';
  const set = (P.data.find(d => d[0] === name) || [])[1], pts = ((set && set.pnlHistory) || []).map(p => [p[0], n(p[1])]).filter(p => p[0] >= fromUs && p[0] <= toUs);
  return pts.length > 1 ? pts[pts.length - 1][1] - pts[0][1] : null;
}
function weekData(w, fills) {
  const byDay = Array(7).fill(0), byHour = Array(24).fill(0), byMkt = {}, active = new Set();
  let vol = 0, fees = 0, closed = 0, mk = 0, buyV = 0, sellV = 0, maxFill = 0, wins = 0, losses = 0, winS = 0, lossS = 0, best = 0, worst = 0;
  const byMktNet = {};
  for (const f of fills) {
    const v = n(f.size) * n(f.price), t = f.createdAt / 1000, k = Math.max(0, Math.min(6, Math.floor((t - w.from) / 864e5))), pnl = n(f.closedPnl);
    byDay[k] += v; byHour[new Date(t).getUTCHours()] += v; vol += v; fees += n(f.fee); closed += pnl;
    if (f.role === 'MAKER') mk += v; if (f.side === 'BUY') buyV += v; else sellV += v;
    if (v > maxFill) maxFill = v; byMkt[f.marketDisplayName] = (byMkt[f.marketDisplayName] || 0) + v; active.add(k);
    byMktNet[f.marketDisplayName] = (byMktNet[f.marketDisplayName] || 0) + pnl - n(f.fee);
    if (pnl > 0) { wins++; winS += pnl; if (pnl > best) best = pnl; } else if (pnl < 0) { losses++; lossS += pnl; if (pnl < worst) worst = pnl; }
  }
  const fund = (S.funding || []).filter(x => x.time >= w.from * 1000 && x.time <= w.to * 1000).reduce((a, x) => a + n(x.payment), 0);
  const days = w.cur ? Math.max(1, Math.min(7, Math.ceil((Date.now() - w.from) / 864e5))) : 7;
  let streak = 0, run = 0; byDay.forEach(v => { run = v > 0 ? run + 1 : 0; streak = Math.max(streak, run); });
  let winStreak = 0, wrun = 0; fills.slice().sort((a, b) => a.createdAt - b.createdAt).forEach(f => { const p = n(f.closedPnl); if (p > 0) { wrun++; winStreak = Math.max(winStreak, wrun); } else if (p < 0) wrun = 0; });
  return { w, byDay, byHour, byMkt, byMktNet, winStreak, vol, fees, closed, fund, fills: fills.length, makerVol: mk, makerShare: vol ? mk / vol : 0, buyV, sellV, maxFill, wins, losses, winS, lossS, best, worst,
    streak, active: active.size, days, acct: pnlDelta(w.from * 1000, w.to * 1000) };
}
/* ---- catalogue of stats the user can put on the card (any 6) */
const POSC = '#5ee08a', NEGC = '#ff7a7a', WHITE = '#f1f7f3';
const sc = (v, txt) => [txt, v > 0 ? POSC : v < 0 ? NEGC : WHITE];
const topMkt = d => Object.entries(d.byMkt).sort((a, b) => b[1] - a[1])[0];
const SHM = [
  { id: 'avg_daily', g: 'Activity', label: 'Avg. daily volume', f: d => ['$' + big(d.vol / d.days)] },
  { id: 'active_days', g: 'Activity', label: 'Active days', f: d => [`${d.active} / ${d.days}`] },
  { id: 'fills', g: 'Activity', label: 'Fills', f: d => [fmt(d.fills, 0)] },
  { id: 'fills_day', g: 'Activity', label: 'Fills per active day', f: d => [d.active ? fmt(d.fills / d.active, 0) : '—'] },
  { id: 'avg_fill', g: 'Activity', label: 'Avg. fill size', f: d => [d.fills ? '$' + fmt(d.vol / d.fills, 0) : '—'] },
  { id: 'largest_fill', g: 'Activity', label: 'Largest fill', f: d => [d.fills ? '$' + big(d.maxFill) : '—'] },
  { id: 'best_day', g: 'Activity', label: 'Best day (volume)', f: d => { const m = Math.max(...d.byDay); return m > 0 ? ['$' + big(m) + ' · ' + dayLbl(d.w.from + d.byDay.indexOf(m) * 864e5, { weekday: 'short' })] : ['—']; } },
  { id: 'streak', g: 'Activity', label: 'Longest active streak', f: d => [`${d.streak} day${d.streak === 1 ? '' : 's'}`] },
  { id: 'peak_hour', g: 'Activity', label: 'Most active hour (UTC)', f: d => { const m = Math.max(...d.byHour); return m > 0 ? [String(d.byHour.indexOf(m)).padStart(2, '0') + ':00'] : ['—']; } },
  { id: 'markets', g: 'Activity', label: 'Markets traded', f: d => [fmt(Object.keys(d.byMkt).length, 0)] },
  { id: 'top_market', g: 'Activity', label: 'Top market', f: d => { const t = topMkt(d); return t ? [`${t[0].replace('-USD', '')} · ${fmt(t[1] / d.vol * 100, 0)}%`] : ['—']; } },
  { id: 'maker_share', g: 'Activity', label: 'Maker share', f: d => [fmt(d.makerShare * 100, 0) + '%'] },
  { id: 'maker_vol', g: 'Activity', label: 'Maker volume', f: d => ['$' + big(d.makerVol)] },
  { id: 'taker_vol', g: 'Activity', label: 'Taker volume', f: d => ['$' + big(d.vol - d.makerVol)] },
  { id: 'buy_sell', g: 'Activity', label: 'Buys / sells (volume)', f: d => d.vol ? [`${fmt(d.buyV / d.vol * 100, 0)}% / ${fmt(d.sellV / d.vol * 100, 0)}%`] : ['—'] },
  { id: 'vs_prev', g: 'Activity', label: 'Volume vs previous week', f: d => d.prevVol === undefined ? ['…'] : (d.prevVol ? sc(d.vol - d.prevVol, sgn((d.vol / d.prevVol - 1) * 100, 1) + '%') : ['—', WHITE]) },
  { id: 'fees', g: 'Costs', label: 'Fees paid', f: d => [money(-d.fees), WHITE] },
  { id: 'fee_bps', g: 'Costs', label: 'Fee rate (bps of volume)', f: d => [d.vol ? fmt(d.fees / d.vol * 1e4, 2) + ' bps' : '—'] },
  { id: 'realized_net', g: 'Performance (P&L)', pnl: true, label: 'Realized PnL (net of fees)', f: d => sc(d.closed - d.fees, smoney(d.closed - d.fees)) },
  { id: 'realized_gross', g: 'Performance (P&L)', pnl: true, label: 'Realized PnL (gross)', f: d => sc(d.closed, smoney(d.closed)) },
  { id: 'account_change', g: 'Performance (P&L)', pnl: true, label: 'Total account change', f: d => d.acct == null ? ['—', WHITE] : sc(d.acct, smoney(d.acct)) },
  { id: 'funding', g: 'Performance (P&L)', pnl: true, label: 'Funding', f: d => sc(d.fund, smoney(d.fund)) },
  { id: 'net_total', g: 'Performance (P&L)', pnl: true, label: 'Net PnL (realized − fees + funding)', f: d => sc(d.closed - d.fees + d.fund, smoney(d.closed - d.fees + d.fund)) },
  { id: 'edge_bps', g: 'Performance (P&L)', pnl: true, label: 'Net edge (bps of volume)', f: d => { const e = d.vol ? (d.closed - d.fees + d.fund) / d.vol * 1e4 : null; return e == null ? ['—', WHITE] : sc(e, sgn(e, 2) + ' bps'); } },
  { id: 'pnl_per_m', g: 'Performance (P&L)', pnl: true, label: 'Net PnL per $1M volume', f: d => { const e = d.vol ? (d.closed - d.fees + d.fund) / d.vol * 1e6 : null; return e == null ? ['—', WHITE] : sc(e, smoney(e, 0)); } },
  { id: 'win_rate', g: 'Performance (P&L)', pnl: true, label: 'Win rate (closing fills)', f: d => [d.wins + d.losses ? fmt(d.wins / (d.wins + d.losses) * 100, 1) + '%' : '—', WHITE] },
  { id: 'profit_factor', g: 'Performance (P&L)', pnl: true, label: 'Profit factor', f: d => [d.lossS ? fmt(d.winS / -d.lossS, 2) : '—', WHITE] },
  { id: 'best_market', g: 'Performance (P&L)', pnl: true, label: 'Best market (net PnL)', f: d => { const e = Object.entries(d.byMktNet).sort((a, b) => b[1] - a[1])[0]; return e ? sc(e[1], e[0].replace('-USD', '') + '  ' + smoney(e[1])) : ['—', WHITE]; } },
  { id: 'worst_market', g: 'Performance (P&L)', pnl: true, label: 'Worst market (net PnL)', f: d => { const e = Object.entries(d.byMktNet).sort((a, b) => a[1] - b[1])[0]; return e ? sc(e[1], e[0].replace('-USD', '') + '  ' + smoney(e[1])) : ['—', WHITE]; } },
  { id: 'win_streak', g: 'Performance (P&L)', pnl: true, label: 'Longest winning streak', f: d => [`${d.winStreak} fill${d.winStreak === 1 ? '' : 's'}`, WHITE] },
  { id: 'best_fill', g: 'Performance (P&L)', pnl: true, label: 'Best single fill', f: d => sc(d.best, smoney(d.best)) },
  { id: 'worst_fill', g: 'Performance (P&L)', pnl: true, label: 'Worst single fill', f: d => sc(d.worst, smoney(d.worst)) },
];
const SHP = {
  default: ['realized_net', 'account_change', 'funding', 'fees', 'avg_daily', 'active_days'],
  activity: ['fills', 'avg_fill', 'maker_share', 'fees', 'avg_daily', 'active_days'],
  trader: ['win_rate', 'profit_factor', 'edge_bps', 'top_market', 'best_day', 'streak'],
};
{ const ok = new Set(SHM.map(m => m.id)); if (!Array.isArray(SH.slots) || SH.slots.length !== 6 || SH.slots.some(x => !ok.has(x))) SH.slots = SHP.default.slice(); }
function shItems(d) {
  const by = Object.fromEntries(SHM.map(m => [m.id, m]));
  return SH.slots.map(id => { const m = by[id] || by.fills, r = m.f(d); return [m.label, r[0], r[1] || WHITE]; });
}
const SHPNL = new Set(SHM.filter(m => m.pnl).map(m => m.id));
const shHasPnl = () => SH.slots.some(id => SHPNL.has(id));
const shSync = () => { $('#shPnl').checked = shHasPnl(); };
const dayLbl = (ms, o) => new Date(ms).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
async function loadShare() {
  const tok = ++SH.tok, w = weeksList(S).find(x => x.n === SH.week); if (!w) return;
  $('#shWeek').textContent = `Week ${w.n} · ${dayLbl(w.from, { day: '2-digit', month: '2-digit' })} – ${dayLbl(w.end, { day: '2-digit', month: '2-digit' })}${w.cur ? ' (current)' : ''}`;
  const pv = store.get(shKey(), {}); $('#shPts').value = pv.pts ?? ''; $('#shRank').value = pv.rank ?? '';
  const key = S.addr + ':' + S.idx + ':' + w.n, hit = SH.cache[key];
  if (hit && !w.cur) { SH.data = weekData(w, hit); drawPreview(); ensurePrev(); return; }
  $('#shMsg').textContent = 'Loading fills for this week…'; SH.data = null; drawPreview();
  try { const fills = await fetchRange(w.from * 1000, w.to * 1000, tok); if (!fills || tok !== SH.tok) return; SH.cache[key] = fills; SH.data = weekData(w, fills); $('#shMsg').textContent = fills.length >= 100000 ? 'Capped at 100,000 fills.' : ''; }
  catch (e) { $('#shMsg').textContent = 'Could not load fills: ' + e.message; }
  drawPreview(); ensurePrev();
}
async function ensurePrev() {
  const d = SH.data; if (!d || d.prevVol !== undefined || !SH.slots.includes('vs_prev')) return;
  const prev = weeksList(S).find(x => x.n === d.w.n - 1); if (!prev) { d.prevVol = null; drawPreview(); return; }
  const tok = SH.tok, key = S.addr + ':' + S.idx + ':' + prev.n; let fills = SH.cache[key];
  if (!fills) { try { fills = await fetchRange(prev.from * 1000, prev.to * 1000, tok); } catch (e) { return; } if (!fills || tok !== SH.tok) return; SH.cache[key] = fills; }
  const limit = d.w.cur ? prev.from + (Date.now() - d.w.from) : Infinity;   // current week: compare with the same elapsed time of the previous week
  d.prevVol = fills.reduce((a, f) => f.createdAt / 1000 <= limit ? a + n(f.size) * n(f.price) : a, 0); drawPreview();
}
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function drawShare(cv, d, preview, R = 1.5) {   // layout is 1200 x 810; R = output pixel scale
  const W = 1200, H = 810; cv.width = W * R; cv.height = H * R; const c = cv.getContext('2d'); c.setTransform(R, 0, 0, R, 0, 0);
  const FONT = '"Inter","Segoe UI",system-ui,-apple-system,sans-serif', GREEN = '#7dffa6', MUT = '#8aa597', POS = '#5ee08a', NEG = '#ff7a7a';
  const T = (str, x, y, size, color, weight = 600, align = 'left', ls = 0) => { c.font = `${weight} ${size}px ${FONT}`; c.fillStyle = color; c.textAlign = align; if ('letterSpacing' in c) c.letterSpacing = ls + 'px'; c.fillText(str, x, y); if ('letterSpacing' in c) c.letterSpacing = '0px'; };
  // background
  rr(c, 0, 0, W, H, 34); c.save(); c.clip();
  let g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#060d0a'); g.addColorStop(1, '#0b1c14'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  if (SH.bg) { const sc = Math.max(W / SH.bg.width, H / SH.bg.height), dw = SH.bg.width * sc, dh = SH.bg.height * sc; c.drawImage(SH.bg, (W - dw) / 2, (H - dh) / 2, dw, dh); c.fillStyle = `rgba(4,10,7,${SH.dim / 100})`; c.fillRect(0, 0, W, H); }
  g = c.createRadialGradient(W * .88, 40, 10, W * .88, 40, 520); g.addColorStop(0, 'rgba(70,210,120,.20)'); g.addColorStop(1, 'rgba(70,210,120,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.restore(); rr(c, .5, .5, W - 1, H - 1, 34); c.strokeStyle = 'rgba(255,255,255,.08)'; c.lineWidth = 1; c.stroke();
  // header: logo + name
  const name = SH.name.trim();
  // header: embedded Arcus logo + title; no placeholder icon
  const lg = SH.brand; let tx = 56, wordmark = false;
  if (lg) {
    const asp = lg.width / lg.height, lh = 64, lw = Math.min(lh * asp, 280);
    if (asp <= 1.4) { rr(c, 56, 46, lw, lh, 16); c.fillStyle = 'rgba(94,224,138,.13)'; c.fill(); c.strokeStyle = 'rgba(94,224,138,.4)'; c.lineWidth = 1.5; c.stroke(); }
    const pad = asp <= 1.4 ? 10 : 0; c.drawImage(lg, 56 + pad, 46 + pad, lw - 2 * pad, lh - 2 * pad);
    tx = 56 + lw + 24; wordmark = asp > 1.8;
  }
  if (name || !wordmark) T(name || 'Arcus Trade Stats', tx, 92, wordmark ? 40 : 46, '#f1f7f3', 700);
  T('Weekly stats · unofficial', W - 56, 90, 20, MUT, 500, 'right');
  // pills
  const w = d.w, pillTxt = 'WEEK ' + w.n; c.font = `700 20px ${FONT}`; if ('letterSpacing' in c) c.letterSpacing = '2px'; const pw = c.measureText(pillTxt).width + 40; if ('letterSpacing' in c) c.letterSpacing = '0px';
  rr(c, 56, 146, pw, 42, 21); c.fillStyle = 'rgba(94,224,138,.14)'; c.fill(); c.strokeStyle = 'rgba(94,224,138,.55)'; c.lineWidth = 1.5; c.stroke();
  T(pillTxt, 56 + pw / 2, 175, 20, GREEN, 700, 'center', 2);
  const range = `${dayLbl(w.from, { day: 'numeric', month: 'short' })} – ${dayLbl(w.end, { day: 'numeric', month: 'short' })}`;
  T(`Season 1  ·  ${range}${w.cur ? '  ·  in progress' : ''}`, 56 + pw + 20, 175, 24, '#b9cbc0', 500);
  // panels
  const panel = (x, y, wd, h, hl) => { rr(c, x, y, wd, h, 26); c.fillStyle = SH.bg ? (hl ? 'rgba(14,60,38,.55)' : 'rgba(6,14,10,.55)') : (hl ? 'rgba(94,224,138,.07)' : 'rgba(255,255,255,.045)'); c.fill(); c.strokeStyle = hl ? 'rgba(94,224,138,.4)' : 'rgba(255,255,255,.09)'; c.lineWidth = 1.5; c.stroke(); };
  const PY = 214, PH = 276;
  panel(56, PY, 640, PH, false); panel(724, PY, 420, PH, true);
  T('VOLUME TRADED', 90, PY + 52, 20, GREEN, 700, 'left', 3);
  T('$' + big(d.vol), 90, PY + 150, 100, '#f4faf6', 800);
  T(`total notional traded ${w.cur ? 'so far this week' : 'this week'} · not profit`, 90, PY + 184, 20, MUT, 500);
  const mx = Math.max(...d.byDay, 1), bx = 90, bw = 58, gap = 24, base = PY + 238;
  d.byDay.forEach((v, i) => { const h = Math.max(4, v / mx * 40), x = bx + i * (bw + gap); rr(c, x, base - h, bw, h, 7); c.fillStyle = v > 0 ? (v === mx ? 'rgba(200,215,205,.55)' : 'rgba(160,180,168,.38)') : 'rgba(160,180,168,.18)'; c.fill(); T(dayLbl(w.from + i * 864e5, { weekday: 'short' }), x + bw / 2, base + 24, 17, MUT, 500, 'center'); });
  const pv = store.get(shKey(), {}), pts = parseFloat(pv.pts), rank = parseFloat(pv.rank);
  if (isFinite(pts)) {
    T('POINTS', 758, PY + 52, 20, GREEN, 700, 'left', 3);
    T(fmt(pts, pts % 1 ? 2 : 0), 758, PY + 164, 124, GREEN, 800);
    if (isFinite(rank)) T('Rank #' + fmt(rank, 0), 758, PY + 214, 30, '#d7e6dc', 600);
    if (d.vol > 0) T(`${fmt(pts / d.vol * 1e6, 1)} pts per $1M volume`, 758, PY + 252, 20, MUT, 500);
  } else if (preview) {
    c.save(); rr(c, 724 + 6, PY + 6, 408, PH - 12, 22); c.setLineDash([10, 8]); c.strokeStyle = 'rgba(94,224,138,.55)'; c.lineWidth = 2; c.stroke(); c.restore();
    T('POINTS', 758, PY + 52, 20, GREEN, 700, 'left', 3);
    T('←', 758, PY + 150, 84, GREEN, 700);
    T('Enter your points', 758, PY + 196, 32, '#e6f2ea', 700);
    T('Fill in “Points this week” and', 758, PY + 232, 20, MUT, 500);
    T('“Rank” in the form next to the card', 758, PY + 258, 20, MUT, 500);
  } else {
    T('FILLS', 758, PY + 52, 20, GREEN, 700, 'left', 3);
    T(fmt(d.fills, 0), 758, PY + 164, 124, GREEN, 800);
    T(`maker ${fmt(d.makerShare * 100, 0)}% by volume`, 758, PY + 214, 28, '#d7e6dc', 600);
    T(d.fills ? `avg fill $${fmt(d.vol / d.fills, 0)}` : '', 758, PY + 252, 20, MUT, 500);
  }
  // stats grid (6 user-chosen stats)
  shItems(d).forEach((it, i) => {
    const x = 56 + (i % 3) * 380, y = 540 + Math.floor(i / 3) * 100; T(it[0], x, y, 20, MUT, 500);
    let size = 46; c.font = `800 ${size}px ${FONT}`; while (c.measureText(it[1]).width > 330 && size > 24) { size -= 2; c.font = `800 ${size}px ${FONT}`; }
    T(it[1], x, y + 48, size, it[2], 800);
  });
  T('Data from the exchange API · unofficial · not financial advice', 56, H - 54, 17, '#5f776a', 500);
  T('Weeks: Wed 00:00 – Tue 23:59 GMT (assumed, not officially confirmed by the Arcus team)', 56, H - 28, 17, '#5f776a', 500);
}
function shPreviewSize() {
  const cv = $('#shCv'), box = $('#shSlotsBox'), host = box.parentElement;
  cv.style.width = cv.width + 'px'; cv.style.height = cv.height + 'px';   // shown at its real pixel size
  box.style.width = Math.min(cv.width, host.clientWidth || cv.width) + 'px';   // the boxes are as wide as the picture above them
}
function drawPreview() {
  const cv = $('#shCv'); if (!SH.data) { const c = cv.getContext('2d'); cv.width = SH.size; cv.height = Math.floor(SH.size * 810 / 1200); c.fillStyle = '#0a130e'; c.fillRect(0, 0, cv.width, cv.height); c.fillStyle = '#8aa597'; c.font = '20px system-ui'; c.textAlign = 'center'; c.fillText('Loading…', cv.width / 2, cv.height / 2); shPreviewSize(); return; }
  drawShare(cv, SH.data, true, SH.size / 1200); shDims(); shPreviewSize();
  const need = !isFinite(parseFloat(store.get(shKey(), {}).pts)); $('#shPts').classList.toggle('need', need); $('#shRank').classList.toggle('need', need);
}
function buildSlots() {
  const dflt = SHP.default, by = Object.fromEntries(SHM.map(m => [m.id, m])), g = {};
  SHM.filter(m => !dflt.includes(m.id)).forEach(m => (g[m.g] = g[m.g] || []).push(m));
  const opt = m => `<option value="${m.id}"${tipFor(m.label) ? ` title="${esc(tipFor(m.label))}"` : ''}>${m.label}</option>`;
  const opts = `<optgroup label="Default stats (in card order)">${dflt.map(id => opt(by[id])).join('')}</optgroup>` +
    Object.entries(g).map(([k, a]) => `<optgroup label="${k}">${a.map(opt).join('')}</optgroup>`).join('');
  $('#shSlots').innerHTML = SH.slots.map((id, i) => `<div class="shslot"><span class="shn">${i + 1}</span><select data-i="${i}" aria-label="Stat ${i + 1}">${opts}</select></div>`).join('');
  [...$('#shSlots').querySelectorAll('select')].forEach((el, i) => { el.value = SH.slots[i]; });
}
function openShare() {
  if (!S) { status('Load an address first', true); return; }
  const ws = weeksList(S); if (!ws.length) return;
  SH.week = ws[ws.length - 1].n;   // always open on the current week; ‹ goes to earlier weeks
  buildSlots(); shDims(); $('#shName').value = SH.name; shSync(); $('#shDim').value = String(SH.dim); $('#shDimV').textContent = SH.dim + '%'; $('#shBgNote').textContent = SH.bg ? 'Background image is used.' : 'No background selected.';
  $('#shareDlg').showModal(); loadShare();
}
const shStep = d => { const ws = weeksList(S), i = ws.findIndex(x => x.n === SH.week), j = Math.max(0, Math.min(ws.length - 1, i + d)); SH.week = ws[j].n; loadShare(); };
$('#btnShare').onclick = openShare; $('#shClose').onclick = () => $('#shareDlg').close();
$('#shPrev').onclick = () => shStep(-1); $('#shNext').onclick = () => shStep(1);
let shT; const shRedraw = () => { clearTimeout(shT); shT = setTimeout(() => SH.data && drawPreview(), 100); };
$('#shName').oninput = e => { SH.name = e.target.value; store.set('sh_name', SH.name); shRedraw(); };
$('#shSlots').addEventListener('change', e => {
  const sel = e.target.closest('select'); if (!sel) return; const i = +sel.dataset.i, v = sel.value, old = SH.slots[i], j = SH.slots.indexOf(v);
  if (j >= 0 && j !== i) SH.slots[j] = old;   // picking an already used stat swaps the two slots
  SH.slots[i] = v; store.set('sh_slots', SH.slots); buildSlots(); shSync(); shRedraw(); ensurePrev();
});
$('#shPresets').addEventListener('click', e => { const b = e.target.closest('[data-preset]'); if (!b) return; SH.slots = SHP[b.dataset.preset].slice(); store.set('sh_slots', SH.slots); buildSlots(); shSync(); shRedraw(); ensurePrev(); });
function shDims() { $('#shDims').textContent = `Actual size (1:1) · PNG ${SH.size} × ${Math.floor(SH.size * 810 / 1200)} px · about 330 KB`; }
$('#shPnl').onchange = e => {
  if (!e.target.checked) {   // hide P&L: replace every P&L stat by the first unused activity stat (visible in the dropdowns)
    SH.pnlBackup = SH.slots.slice(); store.set('sh_slots_backup', SH.pnlBackup);
    const fb = ['fills', 'avg_fill', 'maker_share', 'top_market', 'markets', 'fee_bps', 'best_day', 'streak', 'peak_hour', 'fills_day', 'largest_fill', 'maker_vol', 'taker_vol', 'buy_sell', 'vs_prev'];
    const used = new Set(SH.slots.filter(id => !SHPNL.has(id)));   // keep every non-P&L pick, fill the P&L slots with distinct activity stats
    SH.slots = SH.slots.map(id => { if (!SHPNL.has(id)) return id; const alt = fb.find(x => !used.has(x)); if (alt) used.add(alt); return alt || id; });
  } else {                   // show P&L again: restore the previous selection (or the defaults)
    const bk = SH.pnlBackup || store.get('sh_slots_backup', null), ok = new Set(SHM.map(m => m.id));
    SH.slots = Array.isArray(bk) && bk.length === 6 && bk.every(x => ok.has(x)) && bk.some(x => SHPNL.has(x)) ? bk.slice() : SHP.default.slice();
  }
  store.set('sh_slots', SH.slots); buildSlots(); shSync(); shRedraw(); ensurePrev();
};
const shSaveNums = () => { store.set(shKey(), { pts: $('#shPts').value, rank: $('#shRank').value }); shRedraw(); };
$('#shPts').oninput = shSaveNums; $('#shRank').oninput = shSaveNums;
$('#shBgBtn').onclick = () => $('#shBg').click();
$('#shBg').onchange = e => {
  const f = e.target.files[0]; if (!f) return; const rd = new FileReader();
  rd.onload = () => { const im = new Image(); im.onload = () => {
      const k = Math.min(1, 1800 / im.width), cvs = document.createElement('canvas'); cvs.width = Math.round(im.width * k); cvs.height = Math.round(im.height * k);
      cvs.getContext('2d').drawImage(im, 0, 0, cvs.width, cvs.height);   // downscale + re-encode so it stays small enough to remember
      const url = cvs.toDataURL('image/jpeg', 0.88), small = new Image();
      small.onload = () => { SH.bg = small; store.set('sh_bg', url.length < 1.8e6 ? url : null); $('#shBgNote').textContent = 'Background image is used.'; shRedraw(); }; small.src = url;
    }; im.onerror = () => { $('#shBgNote').textContent = 'Could not read this image.'; }; im.src = rd.result; };
  rd.readAsDataURL(f); e.target.value = '';
};
$('#shBgClear').onclick = () => { SH.bg = null; store.set('sh_bg', null); $('#shBgNote').textContent = 'No background selected.'; shRedraw(); };
$('#shDim').oninput = e => { SH.dim = +e.target.value; $('#shDimV').textContent = SH.dim + '%'; store.set('sh_dim', SH.dim); shRedraw(); };
async function shBlob() { if (!SH.data) throw new Error('card is not ready yet'); const off = document.createElement('canvas'); drawShare(off, SH.data, false, SH.size / 1200); return new Promise(r => off.toBlob(r, 'image/png')); }
$('#shDl').onclick = async () => { try { const b = await shBlob(), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `arcus-week-${SH.week}-card.png`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); $('#shMsg').textContent = `Saved: ${SH.size} × ${Math.floor(SH.size * 810 / 1200)} px, ${fmt(b.size / 1024, 0)} KB.`; } catch (e) { $('#shMsg').textContent = e.message; } };
$('#shCopy').onclick = async () => { try { const b = await shBlob(); if (!navigator.clipboard || !window.ClipboardItem) throw new Error('this browser cannot copy images — use Download'); await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); $('#shMsg').textContent = 'Image copied.'; } catch (e) { $('#shMsg').textContent = e.message; } };
/* ---- GMT date-time picker (English, independent of the browser locale) */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const cal = { el: $('#cal'), target: null, y: 0, m: 0, sel: null, hh: 0, mm: 0 };
const p2 = v => String(v).padStart(2, '0');
function calValue() { const [y, m, d] = cal.sel; return `${y}-${p2(m + 1)}-${p2(d)} ${p2(cal.hh)}:${p2(cal.mm)}`; }
function calRender() {
  const first = new Date(Date.UTC(cal.y, cal.m, 1)), lead = (first.getUTCDay() + 6) % 7, today = new Date(), tk = [today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()].join('-');
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(Date.UTC(cal.y, cal.m, 1 - lead + i)), key = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()].join('-'), other = d.getUTCMonth() !== cal.m;
    cells += `<button type="button" class="calday${other ? ' other' : ''}${cal.sel && key === cal.sel.join('-') ? ' sel' : ''}${key === tk ? ' today' : ''}" data-d="${key}">${d.getUTCDate()}</button>`;
  }
  const hs = Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === cal.hh ? ' selected' : ''}>${p2(h)}</option>`).join(''), ms = Array.from({ length: 60 }, (_, m) => `<option value="${m}"${m === cal.mm ? ' selected' : ''}>${p2(m)}</option>`).join('');
  cal.el.innerHTML = `<div class="calhead"><button type="button" class="btn small" data-nav="-1" aria-label="Previous month">‹</button><b>${MONTHS[cal.m]} ${cal.y}</b><button type="button" class="btn small" data-nav="1" aria-label="Next month">›</button></div>
    <div class="calgrid calwd"><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span></div><div class="calgrid">${cells}</div>
    <div class="caltime"><span>Time (GMT)</span><select id="calH">${hs}</select>:<select id="calM">${ms}</select>
      <button type="button" class="btn small" data-t="0:0">00:00</button><button type="button" class="btn small" data-t="23:59">23:59</button></div>
    <div class="calfoot"><button type="button" class="btn small" data-now="1">Now</button><span class="sp"></span><button type="button" class="btn small primary" data-done="1">Done</button></div>`;
}
function calOpen(input) {
  const v = parseGmt(input.value), dt = new Date(isNaN(v) ? Date.now() : v);
  cal.target = input; cal.y = dt.getUTCFullYear(); cal.m = dt.getUTCMonth(); cal.sel = isNaN(v) ? null : [cal.y, cal.m, dt.getUTCDate()];
  cal.hh = isNaN(v) ? (input.id === 'pt' ? 23 : 0) : dt.getUTCHours(); cal.mm = isNaN(v) ? (input.id === 'pt' ? 59 : 0) : dt.getUTCMinutes();
  calRender(); cal.el.hidden = false;
  const r = input.getBoundingClientRect(), w = 290, h = cal.el.offsetHeight;
  cal.el.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  cal.el.style.top = (r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
}
const calClose = () => { cal.el.hidden = true; cal.target = null; };
const calApply = () => { if (cal.target && cal.sel) cal.target.value = calValue(); };
cal.el.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.nav) { cal.m += +t.dataset.nav; if (cal.m < 0) { cal.m = 11; cal.y--; } if (cal.m > 11) { cal.m = 0; cal.y++; } calRender(); return; }
  if (t.dataset.d) { cal.sel = t.dataset.d.split('-').map(Number); cal.y = cal.sel[0]; cal.m = cal.sel[1]; calApply(); calRender(); return; }
  if (t.dataset.t) { const [h, m] = t.dataset.t.split(':').map(Number); cal.hh = h; cal.mm = m; if (!cal.sel) { const n0 = new Date(); cal.sel = [n0.getUTCFullYear(), n0.getUTCMonth(), n0.getUTCDate()]; } calApply(); calRender(); return; }
  if (t.dataset.now) { const n0 = new Date(); cal.sel = [n0.getUTCFullYear(), n0.getUTCMonth(), n0.getUTCDate()]; cal.hh = n0.getUTCHours(); cal.mm = n0.getUTCMinutes(); cal.y = cal.sel[0]; cal.m = cal.sel[1]; calApply(); calRender(); return; }
  if (t.dataset.done) calClose();
});
cal.el.addEventListener('change', e => { if (e.target.id === 'calH') cal.hh = +e.target.value; if (e.target.id === 'calM') cal.mm = +e.target.value; if (!cal.sel) { const n0 = new Date(); cal.sel = [n0.getUTCFullYear(), n0.getUTCMonth(), n0.getUTCDate()]; } calApply(); });
document.addEventListener('mousedown', e => { if (!cal.el.hidden && !cal.el.contains(e.target) && !e.target.closest('[data-cal]')) calClose(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !cal.el.hidden) calClose(); });
document.querySelectorAll('[data-cal]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); calOpen($('#' + (el.dataset.cal || el.id))); }));
$('#pgo').addEventListener('click', calClose);
/* ---------------------------------------------------------------- Leaderboard tab (top-100 per window and ranking, from the public Arcus API) */
const LB = { win: ['24h', '30d', 'all'].includes(store.get('lb_win', '30d')) ? store.get('lb_win', '30d') : '30d', sort: ['volume', 'pnl', 'fees'].includes(store.get('lb_sort', 'volume')) ? store.get('lb_sort', 'volume') : 'volume', rows: null, key: null, dir: -1, at: null, found: null, tok: 0 };
const lbOk = v => v != null && isFinite(v) && Math.abs(v) < 9e18;   // Arcus returns int64-max as a placeholder for some fee totals
const lbRow = e => { const vol = lbOk(+e.volume) ? e.volume / SC : null, pnl = lbOk(+e.pnl) ? e.pnl / SC : null, fees = lbOk(+e.feesPaid) ? e.feesPaid / SC : null; return { rank: e.rank, addr: e.address, vol, pnl, fees, edge: vol > 0 && pnl != null ? pnl / vol * 1e6 : null }; };
const shortAddr = a => a.slice(0, 6) + '…' + a.slice(-4);
function lbUi() {
  $('#lbWin').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.w === LB.win));
  $('#lbSort').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.s === LB.sort));
}
async function lbLoad() {
  const tok = ++LB.tok; lbUi(); LB.found = null; $('#lbFound').innerHTML = '';
  $('#lbStatus').className = 'status busy'; $('#lbStatus').innerHTML = '<i class="spin"></i>Loading the leaderboard…';
  try {
    const d = await get(API, '/leaderboard', { window: LB.win, sortBy: LB.sort, limit: 100 }, 20);
    if (tok !== LB.tok) return;
    LB.rows = (d.entries || []).map(lbRow); LB.at = Date.now(); LB.key = null; LB.dir = -1;
    $('#lbStatus').className = 'status'; $('#lbStatus').textContent = `Top ${LB.rows.length} · ${{ '24h': 'last 24 hours', '30d': 'last 30 days', all: 'all time' }[LB.win]} · ranked by ${{ volume: 'volume', pnl: 'realized PnL', fees: 'fees paid' }[LB.sort]} · loaded ${new Date().toLocaleTimeString('en-US', { hour12: false })}`;
    lbRender();
    if (S && S.addr && !LB.rows.some(r => r.addr === S.addr)) lbFind(S.addr);   // the address opened in My stats: show its rank even when it is outside the top 100
  } catch (e) { if (tok === LB.tok) { $('#lbStatus').className = 'status err'; $('#lbStatus').textContent = 'Could not load the leaderboard: ' + e.message; } }
}
function lbRender() {
  const rows = LB.rows || []; if (!rows.length) { $('#lbTable').innerHTML = '<tr><td class="empty" style="text-align:center">No data</td></tr>'; $('#lbKpis').innerHTML = ''; return; }
  const sum = k => rows.reduce((a, r) => a + (r[k] || 0), 0), edges = rows.map(r => r.edge).filter(x => x != null).sort((a, b) => a - b), med = edges.length ? edges[edges.length >> 1] : null;
  $('#lbKpis').innerHTML = [['Volume of the top ' + rows.length, '$' + big(sum('vol'))], ['Realized PnL of the top ' + rows.length, smoney(sum('pnl'), 0)], ['Profitable', `${rows.filter(r => r.pnl > 0).length} of ${rows.length}`], ['Median PnL per $1M volume', med == null ? '—' : smoney(med, 0)]]
    .map(([k, v]) => `<div>${k}<b class="num">${v}</b></div>`).join('');
  let list = rows.slice(); if (LB.key) list.sort((a, b) => ((a[LB.key] == null) - (b[LB.key] == null)) || (a[LB.key] > b[LB.key] ? 1 : a[LB.key] < b[LB.key] ? -1 : 0) * LB.dir);
  const me = S && S.addr, fd = LB.found && LB.found.addr, th = (k, t, tip) => `<th data-k="${k}"${tip ? ` title="${esc(tip)}"` : ''}>${t}${LB.key === k ? (LB.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`;
  const medal = r => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : r;
  $('#lbTable').innerHTML = `<thead><tr>${th('rank', '#', 'Rank in this ranking')}<th style="text-align:left">Address</th>${th('vol', 'Volume')}${th('pnl', 'Realized PnL', 'Sum of closedPnl in the window, before funding and unrealized PnL')}${th('fees', 'Fees paid')}${th('edge', 'PnL per $1M', 'Realized PnL divided by volume, scaled to $1,000,000 traded')}<th></th></tr></thead><tbody>` +
    list.map(r => `<tr class="lbrow${r.addr === me || r.addr === fd ? ' me' : ''}"><td class="num"><span class="lbmedal">${medal(r.rank)}</span></td><td class="lbaddr" style="text-align:left" title="${r.addr}">${shortAddr(r.addr)} <button class="btn tiny" data-copy="${r.addr}" type="button" title="Copy address">copy</button></td><td class="num">${r.vol == null ? '—' : '$' + big(r.vol)}</td><td class="num ${cls(r.pnl)}">${r.pnl == null ? '—' : smoney(r.pnl, 0)}</td><td class="num">${r.fees == null ? '—' : '$' + big(r.fees)}</td><td class="num ${cls(r.edge)}">${r.edge == null ? '—' : smoney(r.edge, 0)}</td><td><button class="btn tiny primary" data-open="${r.addr}" type="button">View stats</button></td></tr>`).join('') + '</tbody>';
}
async function lbFind(addr) {
  addr = addr.trim().toLowerCase(); const box = $('#lbFound');
  if (!/^0x[0-9a-f]{40}$/.test(addr)) { box.innerHTML = '<div class="lbfoundbox neg">Invalid address: expected 0x followed by 40 hex characters</div>'; return; }
  box.innerHTML = '<div class="lbfoundbox"><i class="spin"></i>Looking up…</div>';
  try {
    const d = await get(API, '/leaderboard', { address: addr, window: LB.win, sortBy: LB.sort }, 20), e = d.entries && d.entries[0];
    if (!e) { box.innerHTML = `<div class="lbfoundbox">No trades by <span class="lbaddr">${shortAddr(addr)}</span> in this window.</div>`; return; }
    const r = lbRow(e); LB.found = { addr, row: r };
    box.innerHTML = `<div class="lbfoundbox"><span class="lbaddr">${shortAddr(addr)}</span><span><b>Rank #${fmt(r.rank, 0)}</b>${r.rank > 100 ? ' <span class="muted">· outside the top 100</span>' : ''}</span><span>Volume ${r.vol == null ? '—' : '$' + big(r.vol)}</span><span class="${cls(r.pnl)}">Realized PnL ${r.pnl == null ? '—' : smoney(r.pnl, 0)}</span><span>Fees ${r.fees == null ? '—' : '$' + big(r.fees)}</span><button class="btn tiny primary" data-open="${addr}" type="button">View stats</button></div>`;
    lbRender();
  } catch (err) { box.innerHTML = `<div class="lbfoundbox neg">${esc(err.message)}</div>`; }
}
$('#lbWin').addEventListener('click', e => { const b = e.target.closest('button[data-w]'); if (!b) return; LB.win = b.dataset.w; store.set('lb_win', LB.win); lbLoad(); });
$('#lbSort').addEventListener('click', e => { const b = e.target.closest('button[data-s]'); if (!b) return; LB.sort = b.dataset.s; store.set('lb_sort', LB.sort); lbLoad(); });
$('#lbRefresh').onclick = () => lbLoad();
$('#lbFind').addEventListener('submit', e => { e.preventDefault(); lbFind($('#lbAddr').value); });
$('#lbTable').addEventListener('click', e => { const th = e.target.closest('th[data-k]'); if (th) { const k = th.dataset.k; if (LB.key === k) LB.dir *= -1; else { LB.key = k; LB.dir = k === 'rank' ? 1 : -1; } lbRender(); } });
document.addEventListener('click', e => {
  const o = e.target.closest('[data-open]'); if (o) { showView('stats'); $('#addr').value = o.dataset.open; loadWallet(o.dataset.open, 0); return; }
  const c = e.target.closest('[data-copy]'); if (c) { try { navigator.clipboard.writeText(c.dataset.copy); const t = c.textContent; c.textContent = 'copied'; setTimeout(() => { c.textContent = t; }, 1200); } catch (err) { } }
});

/* ---- tabs: My stats / Leaderboard */
function showView(v, keepHash) {
  const lbv = v === 'lb';
  $('#viewStats').hidden = lbv; $('#viewLb').hidden = !lbv;
  document.querySelectorAll('#tabs .tab').forEach(t => t.classList.toggle('on', t.dataset.view === v));
  $('#btnShare').hidden = lbv; $('#btnCards').hidden = lbv; if (lbv) $('#cardsPanel').hidden = true;
  if (!keepHash) history.replaceState(null, '', lbv ? '#leaderboard' : (S ? '#' + S.addr + (S.idx ? ':' + S.idx : '') : location.pathname + location.search));
  if (lbv && !LB.rows) lbLoad(); else if (lbv) lbRender();
}
$('#tabs').addEventListener('click', e => { const t = e.target.closest('.tab'); if (t) showView(t.dataset.view); });
addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h === 'leaderboard') showView('lb', true); else if (/^0x[0-9a-fA-F]{40}/.test(h)) { const [a, i] = h.split(':'); showView('stats', true); if (!S || S.addr !== a.toLowerCase() || S.idx !== (parseInt(i || '0', 10) || 0)) { $('#addr').value = a; loadWallet(a, parseInt(i || '0', 10) || 0); } } });
$('#ver').textContent = VERSION;
renderCardsList(); renderRecent(); setAuto(); renderPeriodBar();
{ const h = location.hash.slice(1); if (h === 'leaderboard') showView('lb', true); else if (h) { const [a, i] = h.split(':'); $('#addr').value = a; loadWallet(a, parseInt(i || '0', 10) || 0); } }
})();
