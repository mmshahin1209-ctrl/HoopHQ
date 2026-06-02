/* ─────────────────────────────────────────────────────────────────
   HoopHQ ESPN Gamelog Proxy — Cloudflare Worker

   ESPN has free, well-maintained NBA gamelog endpoints, but they
   don't send CORS headers, so a browser can't call them directly.
   This Worker sits in front of ESPN and adds:
     • CORS headers (so the browser is allowed to read the response)
     • A tiny edge cache (so we don't hammer ESPN)
     • A simple GET interface: ?name=Player+Name&team=ABBR

   ROUTES
     GET /gamelog?name=<player name>&team=<team abbr>
       → { player, espnId, games: [{ date, opp, isHome, pts, reb, ast, ... }] }
     GET /health
       → { ok: true }

   DEPLOY (5 minutes, free tier — see worker/README.md):
     1. npm install -g wrangler
     2. wrangler login
     3. cd worker && wrangler deploy
     4. Copy the workers.dev URL into script.js → ESPN_PROXY_URL

   The Worker is platform-portable: the body of `handleRequest` is
   plain fetch + standard Response, so it also runs on Vercel Edge,
   Deno Deploy, AWS Lambda, etc., with only the export changed.
   ───────────────────────────────────────────────────────────────── */

/* ── ESPN team-id map. Our internal team abbreviations
      → ESPN's numeric team IDs (well-known and stable). */
const ESPN_TEAM_ID = {
  ATL:1, BOS:2, NOP:3, CHI:4, CLE:5, DAL:6, DEN:7, DET:8, GSW:9,
  HOU:10, IND:11, LAC:12, LAL:13, MIA:14, MIL:15, MIN:16, BKN:17,
  NYK:18, ORL:19, PHI:20, PHX:21, POR:22, SAC:23, SAS:24, OKC:25,
  UTA:26, WAS:27, TOR:28, MEM:29, CHA:30,
};

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const CACHE_TTL_SECONDS = 60 * 30;  // 30 min — gamelog updates after each finished game

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age':       '86400',
};

const jsonResponse = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
      ...corsHeaders,
      ...extraHeaders,
    },
  });

/* Find a player on a team roster by name (case-insensitive, allows
   partial matches like "wembanyama" or "shai gilgeous"). */
async function findAthleteOnTeam(teamAbbr, playerName) {
  const teamId = ESPN_TEAM_ID[teamAbbr.toUpperCase()];
  if (!teamId) return { error: `Unknown team abbreviation: ${teamAbbr}` };

  const url = `${ESPN_BASE}/teams/${teamId}/roster`;
  const res = await fetch(url);
  if (!res.ok) return { error: `ESPN roster fetch failed: ${res.status}` };
  const json = await res.json();

  const athletes = json.athletes || [];
  const needle = playerName.toLowerCase().trim();

  /* Try exact full-name match first, then partial */
  let match = athletes.find(a =>
    (a.fullName || a.displayName || '').toLowerCase() === needle
  );
  if (!match) {
    match = athletes.find(a => {
      const full = (a.fullName || a.displayName || '').toLowerCase();
      return full.includes(needle) || needle.includes(a.lastName?.toLowerCase() || 'x');
    });
  }
  if (!match) {
    return {
      error: `No athlete matching "${playerName}" on ${teamAbbr}`,
      tried: athletes.slice(0, 5).map(a => a.fullName || a.displayName),
    };
  }
  return {
    athlete: {
      id: match.id,
      name: match.fullName || match.displayName,
      position: match.position?.abbreviation || '',
      jersey: match.jersey || '',
    },
  };
}

/* Pull the gamelog for an athlete and flatten ESPN's nested response
   into a simple array of game objects the frontend can consume. */
async function fetchGamelog(athleteId) {
  const url = `${ESPN_BASE}/athletes/${athleteId}/gamelog`;
  const res = await fetch(url);
  if (!res.ok) return { error: `ESPN gamelog fetch failed: ${res.status}` };
  const json = await res.json();

  /* ESPN gamelog shape: events keyed by event id; seasonTypes contains
     the regular season + playoffs groupings. Stat labels appear in
     `names` and the values in each event's `stats` array. */
  const events = json.events || {};
  const stats  = json.seasonTypes?.[0]?.categories || [];

  /* Build a flat list of game events, newest first. */
  const games = [];
  Object.entries(events).forEach(([id, ev]) => {
    const statRow = (ev.stats || []).map(Number);
    /* Find indices for the stats we care about. ESPN uses these
       short labels: MIN PTS REB AST FG FG% 3PT 3P% FT FT% STL BLK TO PF */
    const labelMap = (json.labels || []).reduce((acc, l, i) => { acc[l] = i; return acc; }, {});
    const pick = label => (labelMap[label] != null ? statRow[labelMap[label]] : null);

    games.push({
      id,
      date: ev.gameDate || ev.gameDateString || '',
      opp: ev.opponent?.abbreviation || '',
      isHome: !ev.atVs || ev.atVs === 'vs',
      pts: pick('PTS'),
      reb: pick('REB'),
      ast: pick('AST'),
      min: pick('MIN'),
      fg:  pick('FG'),
      fgPct:  pick('FG%'),
      threePt: pick('3PT'),
      ft:  pick('FT'),
      stl: pick('STL'),
      blk: pick('BLK'),
      to:  pick('TO'),
      result: ev.gameResult || '',
    });
  });

  games.sort((a, b) => new Date(b.date) - new Date(a.date));
  return { games };
}

async function handleRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const { pathname, searchParams } = url;

  if (pathname === '/health' || pathname === '/') {
    return jsonResponse({ ok: true, service: 'hoophq-espn-proxy' });
  }

  if (pathname === '/gamelog') {
    const name = searchParams.get('name');
    const team = searchParams.get('team');
    if (!name || !team) {
      return jsonResponse({ error: 'Missing ?name= or ?team= query params' }, 400);
    }

    /* 1. Find the athlete on the team roster */
    const lookup = await findAthleteOnTeam(team, name);
    if (lookup.error) return jsonResponse(lookup, 404);

    /* 2. Fetch the gamelog */
    const log = await fetchGamelog(lookup.athlete.id);
    if (log.error) return jsonResponse({ ...lookup, ...log }, 502);

    return jsonResponse({
      player: lookup.athlete,
      games: log.games,
      cachedAt: new Date().toISOString(),
    });
  }

  return jsonResponse({ error: 'Not found', tryPath: '/gamelog?name=...&team=...' }, 404);
}

/* Cloudflare Workers export */
export default {
  fetch(request) { return handleRequest(request); },
};
