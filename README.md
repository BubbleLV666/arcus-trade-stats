# Arcus Trade Stats

Static site (HTML + CSS + JS, no build step, no server): enter a wallet address and get its statistics from the
public Arcus API (`api.arcus.xyz`, CORS is open). Requests go straight from the visitor's browser, so rate limits
apply per visitor IP and hosting costs nothing.

## What it shows
Equity / PnL / ROI, volume (24h / 7d / 30d / all time) and fees, fee tier, leaderboard rank by volume and PnL,
equity and PnL charts, risk (maintenance margin, buffer, leverage, long/short split), positions with estimated
liquidation prices, fill analysis (maker/taker, win rate, profit factor, per-market, per-day, per-hour), funding,
deposits/withdrawals, open orders, recent fills, and the Arcus points season (weeks, total points distributed,
next drop). Cards are toggled with checkboxes ("Cards ⚙"); the choice is stored in the browser.

## Leaderboard tab
Second tab with the top-100 traders from the public Arcus leaderboard: windows 24h / 30d / all time, ranked by volume, realized PnL or fees.
Shows volume, realized PnL, fees and PnL per $1M volume; "Find" looks up any address's rank in the selected ranking; "View stats" opens an address
in the first tab. Deep link: `#leaderboard`. The API returns at most 100 rows per ranking.

## Period
* Period bar: "All time", Arcus weeks (Week 1, 2 …), "Current" and "Custom range…". Weeks run from Wednesday 00:00 GMT to Tuesday
  23:59 GMT (Week 1 = 30 Sep – 6 Oct, Week 2 = 7 – 13 Oct, …). This is an assumption: the Arcus team has not officially confirmed that the
  weekly snapshot is taken at this time. The site and the stats image say so. The period affects volume, fees, PnL, funding, transfers, fills and charts.
  Positions, risk and orders always show the current state.


## Stats image (PNG for Discord)
"🖼 Create stats image" opens a weekly card (volume, weekday bars, fills/points panel, PnL, funding, fees, active days). Use ‹ › to switch
weeks. Display name, optional background image, points and rank are typed by you (the Arcus API does not expose points or a weekly rank
per wallet); "show profit / loss" hides the PnL block. The card never contains the wallet address or balances.

The six stats at the bottom of the card are user-selectable (28+ available: activity, costs, P&L, best/worst market,
winning streak, volume vs previous week, …). Defaults: Realized PnL (net), Total account change, Funding, Fees paid,
Avg. daily volume, Active days; presets "Default", "Activity" and "Trader" restore common sets.

## Limitations
* Ranks: the leaderboard API supports only the windows `all`, `30d` and `24h`, so a rank for one specific week cannot be fetched.
* Per-wallet points are not available: `points-api.arcus.xyz/v1/points/{address}` requires the owner to sign in (Privy).
* Arcus serves account data only for allow-listed addresses (otherwise `address not on access whitelist`).
* Fill analysis covers the last N fills (default 5,000) or the whole selected period; the API allows about
  one request of 1,000 fills per second.
* Liquidation price is a cross-margin estimate, not the exchange formula.

## Run locally
    python -m http.server 8800        # inside this folder
    open http://localhost:8800/#0xADDRESS

## GitHub Pages
1. Create a repository and put the contents of this folder in its root (`index.html`, `app.js`, `style.css`, `.nojekyll`).
2. Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`.
3. The site appears at `https://<user>.github.io/<repo>/`; link to a wallet with `…/#0xADDRESS` (or `#0xADDRESS:1` for subaccount 1).

Unofficial project, not affiliated with Arcus.

## Logo and background on the stats image
The Arcus logo is embedded in `app.js` (as a data URI, so the image can always be exported, even when `index.html` is opened straight from disk).
The stats-image window lets users upload a background image with adjustable dimming. Keep the "unofficial" label if you publish the site.
