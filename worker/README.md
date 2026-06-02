# HoopHQ ESPN Gamelog Proxy

A tiny Cloudflare Worker that proxies ESPN's NBA gamelog endpoint so the static HoopHQ site can fetch real per-game player stats from the browser.

**Why this exists**: ESPN's gamelog endpoint doesn't send CORS headers, so a browser app can't call it directly. A Worker sits between the browser and ESPN, adds the CORS headers, and lets HoopHQ show real "Last 10" data instead of synthesised numbers.

**Cost**: free. Cloudflare Workers' free tier is 100,000 requests/day — this project will use ~5/visit at most.

---

## What it does

`GET /gamelog?name=Victor+Wembanyama&team=SAS`

1. Looks up the player on ESPN's roster for that team.
2. Pulls their full gamelog (one fetch).
3. Flattens ESPN's nested response into a clean array of game objects.
4. Returns JSON with CORS headers so the browser can read it.

Response shape:

```json
{
  "player": { "id": "5104157", "name": "Victor Wembanyama", "position": "C", "jersey": "1" },
  "games": [
    {
      "id": "401705284",
      "date": "2025-04-12T23:30Z",
      "opp": "PHX",
      "isHome": true,
      "pts": 29, "reb": 13, "ast": 5, "min": 32,
      "fg": "10-19", "threePt": "2-5", "ft": "7-8",
      "stl": 2, "blk": 4, "to": 3,
      "result": "W"
    },
    ...
  ]
}
```

Caches each response for 30 minutes at Cloudflare's edge.

---

## Deploy

### One-time setup (2 minutes)

```bash
# Install Cloudflare's CLI
npm install -g wrangler

# Sign in (opens a browser → log in to your Cloudflare account; create a free one if needed)
wrangler login
```

### Deploy the Worker

```bash
cd worker
wrangler deploy
```

You'll see output like:

```
Uploaded hoophq-espn-proxy (0.50 sec)
Published hoophq-espn-proxy (0.30 sec)
  https://hoophq-espn-proxy.YOUR-USERNAME.workers.dev
Current Version ID: ...
```

Copy that URL.

### Wire HoopHQ to use it

Open `script.js` near the top:

```js
/* Set this to your deployed Cloudflare Worker URL to enable
   real per-game player stats on the Player page. */
const ESPN_PROXY_URL = '';
```

Paste your Worker URL in:

```js
const ESPN_PROXY_URL = 'https://hoophq-espn-proxy.YOUR-USERNAME.workers.dev';
```

Commit + push, and the Player page will start using real ESPN gamelogs instead of the synthesised estimate. Each visitor still hits your Worker (which hits ESPN, with caching), so no API key or login per user.

---

## Test it

After deploy, hit it directly from any browser or terminal:

```bash
# Health check
curl https://hoophq-espn-proxy.YOUR-USERNAME.workers.dev/health
# → {"ok":true,"service":"hoophq-espn-proxy"}

# Real gamelog
curl 'https://hoophq-espn-proxy.YOUR-USERNAME.workers.dev/gamelog?name=Victor+Wembanyama&team=SAS'
# → {"player":...,"games":[...]}
```

If the gamelog endpoint returns games, you're done.

---

## Limits

- **Player must be on the queried team's current ESPN roster.** If a player was traded mid-season, the lookup might fail for their old team. Workaround: HoopHQ falls back to the synthesised estimate when the proxy returns 404.
- **ESPN's gamelog has the current season only.** Historical seasons would need a different endpoint.
- **Cloudflare free plan**: 100,000 requests/day. The 30-minute cache should keep us well under this, but if you ever hit the cap, requests start returning 429 — frontend falls back to synthesis again.

---

## Portability

The Worker is plain `fetch`/`Response` code, so it runs on any modern serverless platform:

- **Cloudflare Workers** (this guide) — recommended, simplest
- **Vercel Edge Functions** — change the export to `export const config = { runtime: 'edge' }; export default handler`
- **Deno Deploy** — change the export to `Deno.serve(handleRequest)`
- **AWS Lambda + Function URL** — wrap `handleRequest` in the Lambda event adapter

The only thing that changes per-platform is the entry-point export. The logic is the same.
