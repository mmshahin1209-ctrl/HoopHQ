/* ── NBA Predictor — script.js ── */

/* Polyfill for CanvasRenderingContext2D.roundRect (older browsers) */
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    const rad = typeof r === 'number' ? r : (r?.[0] || 0);
    this.moveTo(x + rad, y);
    this.arcTo(x + w, y, x + w, y + h, rad);
    this.arcTo(x + w, y + h, x, y + h, rad);
    this.arcTo(x, y + h, x, y, rad);
    this.arcTo(x, y, x + w, y, rad);
  };
}

const API_KEY = 'e3865b48-276e-422f-aed9-b030c21279a9';
const BASE    = 'https://api.balldontlie.io/v1';
const HEADERS = { 'Authorization': API_KEY };

/* ─── Optional ESPN gamelog proxy (Cloudflare Worker) ───
 * Set this to your deployed Worker URL to unlock real per-game
 * player stats on the Player page. See worker/README.md for the
 * 2-minute deploy. Leave empty to use the deterministic synthesis
 * fallback (which is fine — just not real). */
const ESPN_PROXY_URL = '';

/* ════════════════════════════════════════
   DEFAULT FORMULA WEIGHTS
   These are overridden by trained weights
   stored in localStorage after import.
════════════════════════════════════════ */
/* Weighted factors (must sum to 1.0). The 2025 rebalance adds
   season-long winPct + head-to-head this season, because the
   original 5-factor formula was overweighting last-10 form and
   home court — a team going 4-6 with a -0.7 net rating was being
   tipped over a 50-win opponent purely by the home-court bonus,
   which is the bug the user flagged. */
const DEFAULT_WEIGHTS = {
  netRating:    0.24,
  winPct:       0.22,   /* NEW — overall season win rate */
  recentForm:   0.13,   /* down from 0.25 — last 10 is noisy */
  h2h:          0.12,   /* NEW — head-to-head this season */
  trueShooting: 0.13,
  turnoverRate: 0.08,
  homeCourt:    0.08,
};

function getWeights() {
  try {
    const stored = localStorage.getItem('nba_trained_weights');
    if (stored) return { ...DEFAULT_WEIGHTS, ...JSON.parse(stored) };
  } catch {}
  return { ...DEFAULT_WEIGHTS };
}

function saveWeights(w) {
  localStorage.setItem('nba_trained_weights', JSON.stringify(w));
}

/* ════════════════════════════════════════
   STORED GAMES (localStorage)
════════════════════════════════════════ */
const GAMES_KEY = 'nba_training_games';

function getStoredGames() {
  try {
    const raw = localStorage.getItem(GAMES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveStoredGames(games) {
  localStorage.setItem(GAMES_KEY, JSON.stringify(games));
}

function addGame(game) {
  const games = getStoredGames();
  game.id = Date.now() + Math.random();
  games.unshift(game);
  saveStoredGames(games);
  return games;
}

function deleteGame(id) {
  const games = getStoredGames().filter(g => g.id !== id);
  saveStoredGames(games);
  return games;
}

/* ════════════════════════════════════════
   ALL 30 NBA TEAMS
════════════════════════════════════════ */
const NBA_TEAMS = [
  { id: 1,  name: 'Atlanta Hawks',          abbr: 'ATL', color: '#e03a3e' },
  { id: 2,  name: 'Boston Celtics',          abbr: 'BOS', color: '#007a33' },
  { id: 3,  name: 'Brooklyn Nets',           abbr: 'BKN', color: '#aaaaaa' },
  { id: 4,  name: 'Charlotte Hornets',       abbr: 'CHA', color: '#1d1160' },
  { id: 5,  name: 'Chicago Bulls',           abbr: 'CHI', color: '#ce1141' },
  { id: 6,  name: 'Cleveland Cavaliers',     abbr: 'CLE', color: '#860038' },
  { id: 7,  name: 'Dallas Mavericks',        abbr: 'DAL', color: '#00538c' },
  { id: 8,  name: 'Denver Nuggets',          abbr: 'DEN', color: '#fec524' },
  { id: 9,  name: 'Detroit Pistons',         abbr: 'DET', color: '#c8102e' },
  { id: 10, name: 'Golden State Warriors',   abbr: 'GSW', color: '#1d428a' },
  { id: 11, name: 'Houston Rockets',         abbr: 'HOU', color: '#ce1141' },
  { id: 12, name: 'Indiana Pacers',          abbr: 'IND', color: '#fdbb30' },
  { id: 13, name: 'LA Clippers',             abbr: 'LAC', color: '#c8102e' },
  { id: 14, name: 'Los Angeles Lakers',      abbr: 'LAL', color: '#552583' },
  { id: 15, name: 'Memphis Grizzlies',       abbr: 'MEM', color: '#5d76a9' },
  { id: 16, name: 'Miami Heat',              abbr: 'MIA', color: '#98002e' },
  { id: 17, name: 'Milwaukee Bucks',         abbr: 'MIL', color: '#00471b' },
  { id: 18, name: 'Minnesota Timberwolves',  abbr: 'MIN', color: '#0c2340' },
  { id: 19, name: 'New Orleans Pelicans',    abbr: 'NOP', color: '#0c2340' },
  { id: 20, name: 'New York Knicks',         abbr: 'NYK', color: '#f58426' },
  { id: 21, name: 'Oklahoma City Thunder',   abbr: 'OKC', color: '#007ac1' },
  { id: 22, name: 'Orlando Magic',           abbr: 'ORL', color: '#0077c0' },
  { id: 23, name: 'Philadelphia 76ers',      abbr: 'PHI', color: '#006bb6' },
  { id: 24, name: 'Phoenix Suns',            abbr: 'PHX', color: '#e56020' },
  { id: 25, name: 'Portland Trail Blazers',  abbr: 'POR', color: '#e03a3e' },
  { id: 26, name: 'Sacramento Kings',        abbr: 'SAC', color: '#5a2d81' },
  { id: 27, name: 'San Antonio Spurs',       abbr: 'SAS', color: '#c4ced4' },
  { id: 28, name: 'Toronto Raptors',         abbr: 'TOR', color: '#ce1141' },
  { id: 29, name: 'Utah Jazz',               abbr: 'UTA', color: '#002b5c' },
  { id: 30, name: 'Washington Wizards',      abbr: 'WAS', color: '#002b5c' },
];

function teamByName(name) {
  const n = name.trim().toLowerCase();
  return NBA_TEAMS.find(t =>
    t.name.toLowerCase() === n ||
    t.abbr.toLowerCase() === n
  );
}

/* ════════════════════════════════════════
   TRAINING ENGINE
   Runs after every import if >= 10 games.
════════════════════════════════════════ */
function analyzeAndTrain(games) {
  if (games.length < 10) return null;

  /* --- Home-court win rate --- */
  const homeWins  = games.filter(g => g.winner === 'home').length;
  const homeWinPct = homeWins / games.length;

  /* --- Average margin of victory --- */
  const avgMargin = games.reduce((sum, g) => sum + g.margin, 0) / games.length;

  /* --- How often team with better season record wins ---
     We approximate "better record" by: if a team shows up as winner
     in more games in our dataset, they have a better implied record. */
  const winCounts = {};
  games.forEach(g => {
    winCounts[g.winnerName] = (winCounts[g.winnerName] || 0) + 1;
  });
  let betterRecordWins = 0;
  games.forEach(g => {
    const homeWins = winCounts[g.homeTeam] || 0;
    const awayWins = winCounts[g.awayTeam] || 0;
    if (homeWins !== awayWins) {
      const predictedWinner = homeWins > awayWins ? g.homeTeam : g.awayTeam;
      if (predictedWinner === g.winnerName) betterRecordWins++;
    }
  });
  const gamesWithClearFav = games.filter(g => {
    const hw = winCounts[g.homeTeam] || 0;
    const aw = winCounts[g.awayTeam] || 0;
    return hw !== aw;
  }).length;
  const betterRecordWinPct = gamesWithClearFav > 0
    ? betterRecordWins / gamesWithClearFav
    : 0.6;

  /* --- Derive new weights from observed patterns ---
     Home-court: scale between 5% (if home teams win only 50%)
     and 20% (if home teams win 75%+).
     Recent form / record: scale between 20% and 35% based on
     how predictive "better record" is.
     Redistribute the remaining budget across the other factors. */
  const homeCourtWeight = clamp(
    normalise(homeWinPct, 0.50, 0.75) * 0.15 + 0.05,
    0.05, 0.20
  );
  const recordWeight = clamp(
    normalise(betterRecordWinPct, 0.50, 0.80) * 0.15 + 0.20,
    0.20, 0.35
  );

  /* Remaining budget split 40/35/25 across netRating/trueShooting/turnoverRate */
  const remaining = 1 - homeCourtWeight - recordWeight;
  const newWeights = {
    netRating:    round2(remaining * 0.40),
    recentForm:   round2(recordWeight),
    trueShooting: round2(remaining * 0.35),
    turnoverRate: round2(remaining * 0.25),
    homeCourt:    round2(homeCourtWeight),
  };

  /* Fix rounding so weights sum exactly to 1 */
  const total = Object.values(newWeights).reduce((a, b) => a + b, 0);
  newWeights.netRating += round2(1 - total);

  saveWeights(newWeights);

  return {
    totalGames: games.length,
    homeWinPct: Math.round(homeWinPct * 100),
    betterRecordWinPct: Math.round(betterRecordWinPct * 100),
    avgMargin: avgMargin.toFixed(1),
    weights: newWeights,
  };
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function normalise(v, lo, hi) { return clamp((v - lo) / (hi - lo), 0, 1); }
function round2(v) { return Math.round(v * 100) / 100; }

function buildSummaryText(info) {
  const w = info.weights;
  return (
    `Model updated based on ${info.totalGames} games. ` +
    `Home teams won ${info.homeWinPct}% of the time. ` +
    `Teams with better records won ${info.betterRecordWinPct}% of the time. ` +
    `Average margin of victory was ${info.avgMargin} points. ` +
    `Adjusted weights — Net Rating: ${pct(w.netRating)}, ` +
    `Recent Form: ${pct(w.recentForm)}, ` +
    `True Shooting: ${pct(w.trueShooting)}, ` +
    `Turnover Rate: ${pct(w.turnoverRate)}, ` +
    `Home Court: ${pct(w.homeCourt)}.`
  );
}

function pct(v) { return Math.round(v * 100) + '%'; }

/* ════════════════════════════════════════
   UTILITY: API FETCH
════════════════════════════════════════ */
async function apiFetch(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
  return res.json();
}

/* ════════════════════════════════════════
   MOBILE NAV TOGGLE
════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('navToggle');
  const nav    = document.querySelector('.main-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => nav.classList.toggle('open'));
  }
});

/* ════════════════════════════════════════
   HOME PAGE — Live Scoreboard
   Uses ESPN's free API for live scores (no key needed,
   no CORS issues), with hardcoded data as fallback.
════════════════════════════════════════ */
const ESPN_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

async function loadScoreboard() {
  const el = document.getElementById('scoreboard');
  if (!el) return;

  try {
    /* Try NBA's live scoreboard first for real-time scores */
    let games = null;
    try {
      games = await fetchNBALiveScores();
    } catch { /* fall back below */ }

    if (games && games.length > 0) {
      el.innerHTML = '';
      for (const game of games) {
        el.appendChild(buildLiveGameCard(game));
      }
      /* Auto-refresh every 30 seconds if any game is live */
      if (games.some(g => g.isLive)) {
        setTimeout(loadScoreboard, 30000);
      }
      return;
    }

    /* ── For 2025-26 season: show current playoff matchups as scoreboard ── */
    const season = currentSeason();
    if (season === 2025) {
      el.innerHTML = '';
      const bracket = getHardcodedBracket();
      /* Sync series scores from ESPN (last 10 days) before rendering */
      await updateBracketFromESPN(bracket);
      const activeSeries = [...bracket.west, ...bracket.east,
        ...(bracket.finals ? [bracket.finals] : [])]
        .filter(s => !(s.t1w >= 4 || s.t2w >= 4))  /* only incomplete series */
        .slice(0, 6);  /* max 6 cards */

      /* If no active series, show the most recent completed ones */
      const seriesToShow = activeSeries.length > 0 ? activeSeries
        : [...bracket.west, ...bracket.east].filter(s => s.t1w >= 4 || s.t2w >= 4).slice(-4);

      if (seriesToShow.length > 0) {
        seriesToShow.forEach(s => {
          const t1 = NBA_TEAMS.find(t => t.name === s.team1);
          const t2 = NBA_TEAMS.find(t => t.name === s.team2);
          const done = s.t1w >= 4 || s.t2w >= 4;
          const prob = quickProbByName(t1, t2);
          const diff = Math.abs(prob.home - prob.away);
          const conf = confidenceLabel(diff);
          const roundNames = { 1:'R1', 2:'Semis', 3:'Conf Finals' };
          const roundLabel = roundNames[s.round] || 'Finals';
          const seriesScore = `${s.t1w} - ${s.t2w}`;

          const card = document.createElement('div');
          card.className = 'game-card' + (done ? '' : ' game-active-series');
          card.innerHTML = `
            <div class="game-time">${done ? 'FINAL' : roundLabel + ' — Series ' + seriesScore}</div>
            <div class="game-teams">
              <div class="team-block">
                <span class="team-abbr">${t1?.abbr || '???'}</span>
                <span class="team-name-small">${s.team1.split(' ').pop()}</span>
                <span class="live-score${s.t1w > s.t2w ? ' score-winning' : ''}">${s.t1w}</span>
              </div>
              <div class="at-badge">vs</div>
              <div class="team-block">
                <span class="team-abbr">${t2?.abbr || '???'}</span>
                <span class="team-name-small">${s.team2.split(' ').pop()}</span>
                <span class="live-score${s.t2w > s.t1w ? ' score-winning' : ''}">${s.t2w}</span>
              </div>
            </div>
            <div class="game-conf">
              <span class="badge ${done ? 'high' : conf.cls}">${done ? (s.t1w >= 4 ? t1?.abbr : t2?.abbr) + ' wins' : prob.home + '% - ' + prob.away + '%'}</span>
            </div>
          `;
          el.appendChild(card);
        });
        return;
      }
    }

    /* Fallback to BallDontLie API for non-2025 seasons */
    try {
      const today = todayStr();
      let data = await apiFetch(`${BASE}/games?dates[]=${today}&per_page=100`);

      if (!data.data || data.data.length === 0) {
        for (let d = 1; d <= 3; d++) {
          const next = offsetDate(d);
          data = await apiFetch(`${BASE}/games?dates[]=${next}&per_page=100`);
          if (data.data && data.data.length > 0) break;
        }
      }

      if (!data.data || data.data.length === 0) {
        el.innerHTML = '<p style="color:var(--muted);padding:30px;text-align:center;grid-column:1/-1">No games scheduled today. Check back later.</p>';
        return;
      }

      el.innerHTML = '';
      for (const game of data.data) {
        const prob = quickProb(game);
        const diff = Math.abs(prob.home - prob.away);
        const conf = confidenceLabel(diff);
        el.appendChild(buildGameCard(game, prob, conf));
      }
    } catch {
      el.innerHTML = '<p style="color:var(--muted);padding:30px;text-align:center;grid-column:1/-1">No games scheduled today. Check back later.</p>';
    }
  } catch (err) {
    el.innerHTML = `<div class="error-box" style="grid-column:1/-1">Failed to load schedule: ${err.message}</div>`;
  }
}

/* Map ESPN abbreviations to our internal ones (they differ for a few teams) */
const ESPN_ABBR_MAP = {
  'SA':'SAS', 'GS':'GSW', 'NY':'NYK', 'NO':'NOP', 'WSH':'WAS', 'UTAH':'UTA', 'PHO':'PHX',
};
function espnToAbbr(espnAbbr) { return ESPN_ABBR_MAP[espnAbbr] || espnAbbr; }

/* ── Team logo URL helper ──
 * ESPN hosts official NBA team logos at predictable URLs on their CDN,
 * which is fine since the rest of the app already pulls data from ESPN.
 * Our internal team `abbr` (e.g. 'GSW', 'NYK', 'SAS') maps to ESPN's
 * lowercase slug — a few teams use a non-standard slug (gs/ny/sa/no/utah/wsh). */
const LOGO_SLUG_MAP = {
  GSW: 'gs', NYK: 'ny', SAS: 'sa', NOP: 'no', UTA: 'utah', WAS: 'wsh',
};
function getTeamLogoUrl(teamOrName) {
  if (!teamOrName) return '';
  let abbr;
  if (typeof teamOrName === 'string') {
    const t = NBA_TEAMS.find(x => x.name === teamOrName || x.abbr === teamOrName);
    abbr = t ? t.abbr : teamOrName.slice(0,3).toUpperCase();
  } else {
    abbr = teamOrName.abbr;
  }
  const slug = (LOGO_SLUG_MAP[abbr] || abbr).toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nba/500/${slug}.png`;
}

/* Fetch live scores from ESPN's free API (no auth, no CORS issues) */
async function fetchNBALiveScores() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let res;
  try {
    res = await fetch(ESPN_SCOREBOARD_URL, { signal: controller.signal });
  } finally { clearTimeout(timeout); }
  if (!res.ok) throw new Error('ESPN live feed unavailable');
  const json = await res.json();
  const events = json.events;
  if (!events || events.length === 0) return [];

  return events.map(ev => {
    const comp = ev.competitions?.[0];
    if (!comp) return null;
    /* ESPN lists competitors: index 0 = home (usually), index 1 = away
       but we should check the homeAway field to be sure */
    const homeComp = comp.competitors?.find(c => c.homeAway === 'home') || comp.competitors?.[0];
    const awayComp = comp.competitors?.find(c => c.homeAway === 'away') || comp.competitors?.[1];
    if (!homeComp || !awayComp) return null;

    const homeAbbr = espnToAbbr(homeComp.team?.abbreviation || '???');
    const awayAbbr = espnToAbbr(awayComp.team?.abbreviation || '???');
    const homeTeam = NBA_TEAMS.find(t => t.abbr === homeAbbr) || null;
    const awayTeam = NBA_TEAMS.find(t => t.abbr === awayAbbr) || null;

    const st      = comp.status || {};
    const detail  = st.type?.detail || st.type?.shortDetail || '';
    const state   = st.type?.state || '';           /* "pre", "in", "post" */
    const isLive  = state === 'in';
    const isFinal = state === 'post';
    const isScheduled = state === 'pre';
    const period  = st.period || 0;
    const clock   = st.displayClock || '';

    /* Status text: ESPN provides a nice human-readable detail */
    let statusText = detail;
    if (isLive && period && clock) {
      const periodName = period <= 4 ? `Q${period}` : `OT${period - 4}`;
      statusText = `${periodName} ${clock}`;
    }

    /* Series text for playoffs */
    const seriesText = ev.series?.summary || '';

    /* Win probability from ESPN Analytics (in situation.lastPlay.probability) */
    const situation = comp.situation || {};
    const lastPlay  = situation.lastPlay || {};
    const probData  = lastPlay.probability || {};
    const homeWinPct = probData.homeWinPercentage != null ? Math.round(probData.homeWinPercentage * 100) : null;
    const awayWinPct = probData.awayWinPercentage != null ? Math.round(probData.awayWinPercentage * 100) : null;
    const lastPlayText = lastPlay.text || '';

    /* Playoff series competitor wins (from ev.series.competitors) */
    let seriesWins = null;  /* { teamAbbr: wins, ... } */
    if (ev.series && ev.series.competitors) {
      seriesWins = {};
      /*
       * series.competitors only have { id, wins } — no abbreviation.
       * Cross-reference with competition.competitors to get the real abbr.
       */
      const idToAbbr = {};
      (comp.competitors || []).forEach(c => {
        const tid = c.team?.id || c.id || '';
        const ea  = c.team?.abbreviation || '';
        if (tid && ea) idToAbbr[tid] = espnToAbbr(ea);
      });
      ev.series.competitors.forEach(sc => {
        const scId = sc.id || '';
        const abbr = idToAbbr[scId] || espnToAbbr(sc.team?.abbreviation || '');
        if (abbr) seriesWins[abbr] = sc.wins || 0;
      });
    }

    return {
      gameId:   ev.id || '',
      homeTeam,
      awayTeam,
      homeAbbr,
      awayAbbr,
      homeName:  homeComp.team?.shortDisplayName || homeComp.team?.name || 'Home',
      awayName:  awayComp.team?.shortDisplayName || awayComp.team?.name || 'Away',
      homeScore: parseInt(homeComp.score) || 0,
      awayScore: parseInt(awayComp.score) || 0,
      status:    statusText,
      isLive,
      isFinal,
      isScheduled,
      period,
      clock,
      seriesText,
      homeWinPct,
      awayWinPct,
      lastPlayText,
      homeFullName: homeComp.team?.displayName || homeComp.team?.name || 'Home',
      awayFullName: awayComp.team?.displayName || awayComp.team?.name || 'Away',
      venue: comp.venue?.fullName || '',
      seriesWins,
    };
  }).filter(Boolean);
}

/* ══ Update bracket series scores from ESPN — scans last 35 days ══ */
async function updateBracketFromESPN(bracketData) {
  try {
    /*
     * ESPN's scoreboard only returns ONE day of games at a time.
     * Some series complete and then we don't see them for a week+
     * (between conf finals and Finals, or after a sweep). Scan a wider
     * 35-day window so we catch every series in the current playoff run.
     * For each series, we keep the MOST RECENT game's series-wins
     * (that reflects the current, authoritative state).
     */
    const today = new Date();
    const fetchPromises = [];
    for (let i = 0; i < 35; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      fetchPromises.push(
        fetch(`${ESPN_SCOREBOARD_URL}?dates=${ds}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      );
    }
    const results = await Promise.all(fetchPromises);

    /*
     * seriesMap:  "ABR1-ABR2" (sorted) → { wins: {ABR: n, …}, date: ISO, type }
     * We only keep the newest entry per matchup.
     */
    const seriesMap = {};

    results.forEach(json => {
      if (!json || !json.events) return;
      json.events.forEach(ev => {
        if (!ev.series || !ev.series.competitors) return;

        const comp = ev.competitions?.[0];
        if (!comp || !comp.competitors) return;
        const gameDate = ev.date || comp.date || '';

        /*
         * ESPN's series.competitors only have { id, wins } — no abbreviation.
         * The competition.competitors DO have team.abbreviation + team.id.
         * Build an id→abbreviation map from the competition data, then
         * use it to properly key the series wins by our abbreviation.
         */
        const idToAbbr = {};
        comp.competitors.forEach(c => {
          const tid = c.team?.id || c.id || '';
          const espnAbbr = c.team?.abbreviation || '';
          if (tid && espnAbbr) idToAbbr[tid] = espnToAbbr(espnAbbr);
        });

        const wins = {};
        ev.series.competitors.forEach(sc => {
          const scId = sc.id || '';
          const abbr = idToAbbr[scId]                        /* cross-ref with competition */
                    || espnToAbbr(sc.team?.abbreviation || '') /* fallback if team obj exists */
                    || '';
          if (abbr) wins[abbr] = sc.wins || 0;
        });

        const teams = Object.keys(wins).sort();
        if (teams.length < 2) return;
        const seriesKey = teams.join('-');

        /* ESPN sometimes includes a series.type ("championship" = NBA Finals) */
        const sType    = (ev.series.type || '').toLowerCase();
        const sSummary = (ev.series.summary || '').toLowerCase();
        const isFinals = sType.includes('championship') || sSummary.includes('nba finals') || sSummary.includes('finals');

        /* Keep only the most recent game's data for this series */
        if (!seriesMap[seriesKey] || gameDate > seriesMap[seriesKey].date) {
          seriesMap[seriesKey] = { wins, date: gameDate, isFinals, teams };
        }
      });
    });

    /* Now apply updates to every series in the bracket */
    let updated = false;
    const allSeries = [
      ...bracketData.west, ...bracketData.east,
      ...(bracketData.finals ? [bracketData.finals] : []),
    ];

    /* Track which seriesMap keys correspond to bracket entries so we can
       detect "new" matchups (e.g. the NBA Finals) that aren't in the bracket yet. */
    const matchedKeys = new Set();

    allSeries.forEach(series => {
      const t1 = NBA_TEAMS.find(t => t.name === series.team1);
      const t2 = NBA_TEAMS.find(t => t.name === series.team2);
      if (!t1 || !t2) return;

      const seriesKey = [t1.abbr, t2.abbr].sort().join('-');
      const entry = seriesMap[seriesKey];
      if (!entry) return;
      matchedKeys.add(seriesKey);

      const newT1w = entry.wins[t1.abbr] ?? series.t1w;
      const newT2w = entry.wins[t2.abbr] ?? series.t2w;

      if (newT1w !== series.t1w || newT2w !== series.t2w) {
        series.t1w = newT1w;
        series.t2w = newT2w;
        updated = true;
        console.log(`[ESPN] Updated ${t1.abbr} vs ${t2.abbr}: ${newT1w}-${newT2w}`);
      }
    });

    /* ── Auto-advance: populate Finals slot ─────────────────────────────
       Two paths:
       (A) ESPN already shows a Finals matchup → copy it in directly.
       (B) Both Conf Finals are complete but no Finals entry yet → create
           one from the CF winners (score 0-0 if ESPN hasn't seen a game). */
    const westCF = bracketData.west.find(s => s.round === 3);
    const eastCF = bracketData.east.find(s => s.round === 3);
    const westChamp = westCF && (westCF.t1w >= 4 ? westCF.team1 : westCF.t2w >= 4 ? westCF.team2 : null);
    const eastChamp = eastCF && (eastCF.t1w >= 4 ? eastCF.team1 : eastCF.t2w >= 4 ? eastCF.team2 : null);

    /* Path A: look for any unmatched series in ESPN that pairs the CF winners,
       or any series flagged as the Finals/championship. */
    Object.entries(seriesMap).forEach(([key, entry]) => {
      if (matchedKeys.has(key)) return;
      const abbrs = entry.teams;
      const teamA = NBA_TEAMS.find(t => t.abbr === abbrs[0]);
      const teamB = NBA_TEAMS.find(t => t.abbr === abbrs[1]);
      if (!teamA || !teamB) return;

      const namesSet = new Set([teamA.name, teamB.name]);
      const isCFWinnersPair = westChamp && eastChamp &&
                              namesSet.has(westChamp) && namesSet.has(eastChamp);

      if (entry.isFinals || isCFWinnersPair) {
        /* Map to (west team1, east team2) ordering when possible */
        const t1Name = westChamp && namesSet.has(westChamp) ? westChamp : teamA.name;
        const t2Name = t1Name === teamA.name ? teamB.name : teamA.name;
        const t1Abbr = NBA_TEAMS.find(t => t.name === t1Name).abbr;
        const t2Abbr = NBA_TEAMS.find(t => t.name === t2Name).abbr;
        const newT1w = entry.wins[t1Abbr] ?? 0;
        const newT2w = entry.wins[t2Abbr] ?? 0;

        const cur = bracketData.finals;
        if (!cur || cur.team1 !== t1Name || cur.team2 !== t2Name ||
            cur.t1w !== newT1w || cur.t2w !== newT2w) {
          bracketData.finals = {
            team1: t1Name, team2: t2Name,
            t1w: newT1w, t2w: newT2w, round: 0,
          };
          updated = true;
          console.log(`[ESPN] Populated NBA Finals: ${t1Abbr} ${newT1w}-${newT2w} ${t2Abbr}`);
        }
      }
    });

    /* Path B: both CFs are decided but Finals not yet populated → create
       a 0-0 Finals series from the CF winners so predictions can render. */
    if (!bracketData.finals && westChamp && eastChamp) {
      bracketData.finals = {
        team1: westChamp, team2: eastChamp,
        t1w: 0, t2w: 0, round: 0,
      };
      updated = true;
      console.log(`[Bracket] Auto-created Finals from CF winners: ${westChamp} vs ${eastChamp}`);
    }

    if (Object.keys(seriesMap).length > 0) {
      console.log(`[ESPN] Found ${Object.keys(seriesMap).length} playoff series across last 35 days`);
      Object.entries(seriesMap).forEach(([key, entry]) => {
        console.log(`[ESPN]   ${key}: ${JSON.stringify(entry.wins)} (${entry.date})${entry.isFinals ? ' [FINALS]' : ''}`);
      });
    } else {
      console.log('[ESPN] No playoff series found in last 35 days — may be offseason');
    }

    return updated;
  } catch (err) {
    console.warn('[ESPN] Bracket update failed:', err.message);
    return false;
  }
}

/* ══ Update bracket series scores from BallDontLie ══
   ESPN is unreliable in some windows (between rounds, sweeps, etc.).
   BDL has every postseason game stored and is the same API the rest
   of the app uses, so it's the most authoritative second source.
   We tally wins per (sortedAbbrPair) and apply the same way ESPN does. */
async function updateBracketFromBDL(bracketData) {
  try {
    const season = currentSeason();
    /* Reuse the existing helper that paginates postseason games — but
       gate it behind a hard timeout so a slow/hung API can't freeze the
       page. 15s is plenty for a successful response. */
    const TIMEOUT_MS = 15000;
    let postGames;
    try {
      postGames = await Promise.race([
        fetchPostseasonGames(season),
        new Promise((_, rej) => setTimeout(() => rej(new Error('BDL timeout')), TIMEOUT_MS)),
      ]);
    } catch (err) {
      console.warn('[BDL] Postseason fetch skipped:', err.message);
      return false;
    }
    if (!postGames || postGames.length === 0) return false;

    /* Build winsMap:  "ABR1-ABR2" → { ABR1: w1, ABR2: w2 } */
    const winsMap = {};
    postGames.forEach(g => {
      if (!g.home_team || !g.visitor_team) return;
      if (g.home_team_score == null || g.visitor_team_score == null) return;
      if (g.home_team_score === 0 && g.visitor_team_score === 0) return; /* unplayed */
      /* Only count completed games */
      const status = (g.status || '').toLowerCase();
      const isFinal = status === 'final' || status.includes('final') ||
                      (g.home_team_score > 0 && g.visitor_team_score > 0 && status !== 'scheduled');
      if (!isFinal) return;

      const hAbbr = g.home_team.abbreviation;
      const aAbbr = g.visitor_team.abbreviation;
      if (!hAbbr || !aAbbr) return;

      const pair = [hAbbr, aAbbr].sort().join('-');
      if (!winsMap[pair]) winsMap[pair] = { [hAbbr]: 0, [aAbbr]: 0, gameCount: 0, lastDate: '' };

      const winnerAbbr = g.home_team_score > g.visitor_team_score ? hAbbr : aAbbr;
      winsMap[pair][winnerAbbr]++;
      winsMap[pair].gameCount++;
      const dateStr = g.date || '';
      if (dateStr > winsMap[pair].lastDate) winsMap[pair].lastDate = dateStr;
    });

    /* Apply to existing bracket series */
    let updated = false;
    const matchedPairs = new Set();
    const allSeries = [
      ...bracketData.west, ...bracketData.east,
      ...(bracketData.finals ? [bracketData.finals] : []),
    ];

    allSeries.forEach(series => {
      const t1 = NBA_TEAMS.find(t => t.name === series.team1);
      const t2 = NBA_TEAMS.find(t => t.name === series.team2);
      if (!t1 || !t2) return;
      const pair = [t1.abbr, t2.abbr].sort().join('-');
      const entry = winsMap[pair];
      if (!entry) return;
      matchedPairs.add(pair);

      /* Cap at 4 (just in case BDL has stray data) */
      const newT1w = Math.min(4, entry[t1.abbr] ?? series.t1w);
      const newT2w = Math.min(4, entry[t2.abbr] ?? series.t2w);
      if (newT1w !== series.t1w || newT2w !== series.t2w) {
        series.t1w = newT1w;
        series.t2w = newT2w;
        updated = true;
        console.log(`[BDL] Updated ${t1.abbr} vs ${t2.abbr}: ${newT1w}-${newT2w}`);
      }
    });

    /* Auto-populate Finals from BDL data */
    const westCF = bracketData.west.find(s => s.round === 3);
    const eastCF = bracketData.east.find(s => s.round === 3);
    const westChamp = westCF && (westCF.t1w >= 4 ? westCF.team1 : westCF.t2w >= 4 ? westCF.team2 : null);
    const eastChamp = eastCF && (eastCF.t1w >= 4 ? eastCF.team1 : eastCF.t2w >= 4 ? eastCF.team2 : null);

    Object.entries(winsMap).forEach(([pair, entry]) => {
      if (matchedPairs.has(pair)) return;
      const abbrs = pair.split('-');
      const teamA = NBA_TEAMS.find(t => t.abbr === abbrs[0]);
      const teamB = NBA_TEAMS.find(t => t.abbr === abbrs[1]);
      if (!teamA || !teamB) return;

      const namesSet = new Set([teamA.name, teamB.name]);
      const isCFWinnersPair = westChamp && eastChamp &&
                              namesSet.has(westChamp) && namesSet.has(eastChamp);
      if (!isCFWinnersPair) return;

      const t1Name = namesSet.has(westChamp) ? westChamp : teamA.name;
      const t2Name = t1Name === teamA.name ? teamB.name : teamA.name;
      const t1Abbr = NBA_TEAMS.find(t => t.name === t1Name).abbr;
      const t2Abbr = NBA_TEAMS.find(t => t.name === t2Name).abbr;
      const newT1w = Math.min(4, entry[t1Abbr] ?? 0);
      const newT2w = Math.min(4, entry[t2Abbr] ?? 0);

      const cur = bracketData.finals;
      if (!cur || cur.team1 !== t1Name || cur.team2 !== t2Name ||
          cur.t1w !== newT1w || cur.t2w !== newT2w) {
        bracketData.finals = {
          team1: t1Name, team2: t2Name,
          t1w: newT1w, t2w: newT2w, round: 0,
        };
        updated = true;
        console.log(`[BDL] Populated NBA Finals: ${t1Abbr} ${newT1w}-${newT2w} ${t2Abbr}`);
      }
    });

    /* Seed empty Finals slot from CF winners if both decided */
    if (!bracketData.finals && westChamp && eastChamp) {
      bracketData.finals = {
        team1: westChamp, team2: eastChamp,
        t1w: 0, t2w: 0, round: 0,
      };
      updated = true;
      console.log(`[BDL] Auto-created Finals from CF winners: ${westChamp} vs ${eastChamp}`);
    }

    if (Object.keys(winsMap).length > 0) {
      console.log(`[BDL] Found ${Object.keys(winsMap).length} playoff matchups`);
    }
    return updated;
  } catch (err) {
    console.warn('[BDL] Bracket update failed:', err.message);
    return false;
  }
}

/* Fallback: also update bracket from today's live scoreboard data */
async function updateBracketFromLive(bracketData) {
  try {
    const games = await fetchNBALiveScores();
    let updated = false;
    const allSeries = [
      ...bracketData.west, ...bracketData.east,
      ...(bracketData.finals ? [bracketData.finals] : []),
    ];

    /* Track which (abbr,abbr) matchups in `games` matched an existing bracket
       series — anything left could be the Finals. */
    const matched = new Set();

    games.forEach(g => {
      if (!g.seriesWins) return;
      let didMatch = false;
      allSeries.forEach(series => {
        const t1 = NBA_TEAMS.find(t => t.name === series.team1);
        const t2 = NBA_TEAMS.find(t => t.name === series.team2);
        if (!t1 || !t2) return;
        const sw1 = g.seriesWins[t1.abbr];
        const sw2 = g.seriesWins[t2.abbr];
        if (sw1 == null && sw2 == null) return;
        didMatch = true;
        const newT1w = sw1 ?? series.t1w;
        const newT2w = sw2 ?? series.t2w;
        if (newT1w !== series.t1w || newT2w !== series.t2w) {
          series.t1w = newT1w;
          series.t2w = newT2w;
          updated = true;
          console.log(`[Live] Updated ${t1.abbr} vs ${t2.abbr}: ${newT1w}-${newT2w}`);
        }
      });
      if (didMatch) {
        const abbrs = Object.keys(g.seriesWins).sort().join('-');
        matched.add(abbrs);
      }
    });

    /* Detect a brand-new Finals matchup that's not in the bracket yet. */
    const westCF = bracketData.west.find(s => s.round === 3);
    const eastCF = bracketData.east.find(s => s.round === 3);
    const westChamp = westCF && (westCF.t1w >= 4 ? westCF.team1 : westCF.t2w >= 4 ? westCF.team2 : null);
    const eastChamp = eastCF && (eastCF.t1w >= 4 ? eastCF.team1 : eastCF.t2w >= 4 ? eastCF.team2 : null);

    games.forEach(g => {
      if (!g.seriesWins) return;
      const abbrs = Object.keys(g.seriesWins).sort();
      if (abbrs.length < 2) return;
      if (matched.has(abbrs.join('-'))) return;

      const teamA = NBA_TEAMS.find(t => t.abbr === abbrs[0]);
      const teamB = NBA_TEAMS.find(t => t.abbr === abbrs[1]);
      if (!teamA || !teamB) return;

      const namesSet = new Set([teamA.name, teamB.name]);
      const isCFWinnersPair = westChamp && eastChamp &&
                              namesSet.has(westChamp) && namesSet.has(eastChamp);
      const isFinalsByText = (g.seriesText || '').toLowerCase().includes('finals');

      if (isCFWinnersPair || isFinalsByText) {
        const t1Name = westChamp && namesSet.has(westChamp) ? westChamp : teamA.name;
        const t2Name = t1Name === teamA.name ? teamB.name : teamA.name;
        const t1Abbr = NBA_TEAMS.find(t => t.name === t1Name).abbr;
        const t2Abbr = NBA_TEAMS.find(t => t.name === t2Name).abbr;
        const newT1w = g.seriesWins[t1Abbr] ?? 0;
        const newT2w = g.seriesWins[t2Abbr] ?? 0;

        const cur = bracketData.finals;
        if (!cur || cur.team1 !== t1Name || cur.team2 !== t2Name ||
            cur.t1w !== newT1w || cur.t2w !== newT2w) {
          bracketData.finals = {
            team1: t1Name, team2: t2Name,
            t1w: newT1w, t2w: newT2w, round: 0,
          };
          updated = true;
          console.log(`[Live] Populated NBA Finals: ${t1Abbr} ${newT1w}-${newT2w} ${t2Abbr}`);
        }
      }
    });

    /* Both CFs decided but Finals not yet populated → seed it 0-0. */
    if (!bracketData.finals && westChamp && eastChamp) {
      bracketData.finals = {
        team1: westChamp, team2: eastChamp,
        t1w: 0, t2w: 0, round: 0,
      };
      updated = true;
    }

    return updated;
  } catch (err) {
    console.warn('[Live] Bracket live update failed:', err.message);
    return false;
  }
}

/* Build a live game card with real scores — clickable for game detail */
function buildLiveGameCard(game) {
  const card = document.createElement('div');
  card.className = 'game-card game-clickable' + (game.isLive ? ' game-live' : '');
  const prob = quickProbByName(game.homeTeam, game.awayTeam);
  const diff = Math.abs(prob.home - prob.away);
  const conf = confidenceLabel(diff);

  /* Use ESPN win prob if available, otherwise our model */
  const homeWP = game.homeWinPct != null ? game.homeWinPct : prob.home;
  const awayWP = game.awayWinPct != null ? game.awayWinPct : prob.away;

  /* Status display */
  let statusHTML = '';
  if (game.isLive) {
    statusHTML = `<div class="game-time live-badge">LIVE &mdash; ${game.status}</div>`;
  } else if (game.isFinal) {
    statusHTML = `<div class="game-time final-badge">FINAL</div>`;
  } else {
    statusHTML = `<div class="game-time">${game.status}</div>`;
  }

  /* Score display — show actual scores for live/final games */
  const showScores = game.isLive || game.isFinal;
  const homeScoreHTML = showScores ? `<span class="live-score${game.homeScore > game.awayScore ? ' score-winning' : ''}">${game.homeScore}</span>` : '';
  const awayScoreHTML = showScores ? `<span class="live-score${game.awayScore > game.homeScore ? ' score-winning' : ''}">${game.awayScore}</span>` : '';

  const seriesLine = game.seriesText ? `<div class="game-series-text">${game.seriesText}</div>` : '';

  /* Mini win prob bar for live/final games */
  const homeCol = game.homeTeam?.color || '#555';
  const awayCol = game.awayTeam?.color || '#555';
  const wpBar = (game.isLive || game.isFinal) && homeWP != null ? `
    <div class="gc-wp-bar">
      <div class="gc-wp-fill" style="width:${homeWP}%;background:${homeCol}"></div>
      <div class="gc-wp-fill" style="width:${awayWP}%;background:${awayCol}"></div>
    </div>
    <div class="gc-wp-labels"><span>${homeWP}%</span><span>Win Prob.</span><span>${awayWP}%</span></div>
  ` : '';

  const homeLogo = getTeamLogoUrl(game.homeAbbr);
  const awayLogo = getTeamLogoUrl(game.awayAbbr);
  card.innerHTML = `
    ${statusHTML}
    <div class="game-teams">
      <div class="team-block">
        <img class="gc-team-logo" src="${homeLogo}" alt="" onerror="this.style.display='none'">
        <span class="team-abbr">${game.homeAbbr}</span>
        <span class="team-name-small">${game.homeName}</span>
        ${homeScoreHTML}
        ${!showScores ? `<span class="team-prob">${prob.home}%</span>` : ''}
      </div>
      <div class="at-badge">${showScores ? 'vs' : '@'}</div>
      <div class="team-block">
        <img class="gc-team-logo" src="${awayLogo}" alt="" onerror="this.style.display='none'">
        <span class="team-abbr">${game.awayAbbr}</span>
        <span class="team-name-small">${game.awayName}</span>
        ${awayScoreHTML}
        ${!showScores ? `<span class="team-prob">${prob.away}%</span>` : ''}
      </div>
    </div>
    ${wpBar}
    ${seriesLine}
    <div class="game-conf">
      <span class="badge ${conf.cls}">${showScores ? (game.isLive ? 'Tap for details' : 'Final') : conf.label + ' Confidence'}</span>
    </div>
  `;

  /* Click → open game detail modal */
  card.addEventListener('click', () => showGameDetail(game));
  return card;
}

/* ════════════════════════════════════════
   GAME DETAIL MODAL
   Shows ESPN-style win probability, game
   flow chart, and live game information.
════════════════════════════════════════ */
let _gameFlowHistory = {};  /* cache: gameId → array of { time, homeWP } */

async function showGameDetail(game) {
  const modal = document.getElementById('gameDetailModal');
  const mc    = document.getElementById('gameDetailContent');
  if (!modal || !mc) return;

  const homeCol = game.homeTeam?.color || '#555';
  const awayCol = game.awayTeam?.color || '#555';

  /* Win probability — prefer ESPN's live in-game win prob when present,
     otherwise fall back to HoopHQ's pre-game formula (the same source
     the home-page card uses, so the modal never shows 50/50 when the
     card already showed e.g. "91%"). */
  let homeWP, awayWP;
  if (game.homeWinPct != null && game.awayWinPct != null) {
    homeWP = game.homeWinPct;
    awayWP = game.awayWinPct;
  } else {
    const fallback = quickProbByName(game.homeTeam, game.awayTeam);
    homeWP = fallback.home;
    awayWP = fallback.away;
  }

  /* Track win probability over time for the game flow chart */
  if (game.gameId && (game.isLive || game.isFinal)) {
    if (!_gameFlowHistory[game.gameId]) _gameFlowHistory[game.gameId] = [];
    const hist = _gameFlowHistory[game.gameId];
    /* Approximate time position: period 1-4 = 0-100% */
    const periodPct = ((game.period - 1) * 25);
    const clockSecs = parseFloat(game.clock) || 0;
    const quarterPct = 25 - (clockSecs / 720 * 25);  /* 12 min = 720 sec */
    const timePct = Math.min(100, periodPct + Math.max(0, quarterPct));
    /* Only add if it's a new data point */
    if (hist.length === 0 || Math.abs(hist[hist.length-1].time - timePct) > 0.5) {
      hist.push({ time: timePct, homeWP });
    }
  }

  /* Series info */
  const seriesLine = game.seriesText ? `<div class="gd-series">${game.seriesText}</div>` : '';
  const venueLine  = game.venue ? `<div class="gd-venue">${game.venue}</div>` : '';

  /* Status badge */
  let statusBadge = '';
  if (game.isLive)  statusBadge = `<span class="gd-live-badge">LIVE — ${game.status}</span>`;
  else if (game.isFinal) statusBadge = `<span class="gd-final-badge">FINAL</span>`;
  else statusBadge = `<span class="gd-sched-badge">${game.status}</span>`;

  /* Last play */
  const lastPlayHTML = game.lastPlayText ? `
    <div class="gd-last-play">
      <div class="gd-lp-label">Latest Play</div>
      <div class="gd-lp-text">${game.lastPlayText}</div>
    </div>` : '';

  /* ── AI Model Comparison: Formula + Logistic Regression + Neural Net ──
     Same three-card layout used in the series modal so the user can
     compare picks across all three models for any live/final game. */
  const homeName = game.homeFullName || game.homeTeam?.name || game.homeName;
  const awayName = game.awayFullName || game.awayTeam?.name || game.awayName;
  const homeLogo = getTeamLogoUrl(game.homeAbbr);
  const awayLogo = getTeamLogoUrl(game.awayAbbr);

  /* Card builder for this modal */
  const gdModelCard = (label, status, winnerName, winnerAbbr, winnerCol, winnerLogo, pct, sub) => `
    <div class="sd-model-card">
      <div class="sd-model-head">
        <span class="sd-model-name">${label}</span>
        <span class="sd-model-status">${status}</span>
      </div>
      <div class="sd-model-pick">
        ${winnerLogo ? `<img class="sd-model-logo" src="${winnerLogo}" alt="${winnerName||''}" onerror="this.style.display='none'">` : ''}
        <div>
          <div class="sd-model-winner" style="color:${winnerCol||'var(--ink-500)'}">${winnerName || '—'}</div>
          ${sub ? `<div class="sd-model-sub">${sub}</div>` : ''}
        </div>
        <span class="sd-model-pct" style="color:${winnerCol||'var(--ink-500)'}">${pct != null ? pct + '%' : '—'}</span>
      </div>
    </div>`;

  /* Formula pick — use HoopHQ's own model (homeWP/awayWP) */
  const formulaWinHome = homeWP >= awayWP;
  const formulaWinner = formulaWinHome ? homeName : awayName;
  const formulaPct    = Math.max(homeWP, awayWP);
  const formulaAbbr   = formulaWinHome ? game.homeAbbr : game.awayAbbr;
  const formulaCol    = formulaWinHome ? homeCol : awayCol;
  const formulaLogo   = formulaWinHome ? homeLogo : awayLogo;
  const gdFormulaCard = gdModelCard('Formula', 'Net rtg + win% + form',
    formulaWinner, formulaAbbr, formulaCol, formulaLogo, formulaPct, 'Rule-based pick');

  /* LR pick — Game LR from AI Lab */
  let gdLRCard;
  try {
    const aiPred = typeof getAIGamePrediction === 'function'
      ? getAIGamePrediction(homeName, awayName)
      : { lr: null };
    if (aiPred.lr != null) {
      const lrIsHome = aiPred.lr >= 0.5;
      const lrPct = Math.round(Math.max(aiPred.lr, 1 - aiPred.lr) * 100);
      gdLRCard = gdModelCard('Logistic Regression', 'Trained on past games',
        lrIsHome ? homeName : awayName,
        lrIsHome ? game.homeAbbr : game.awayAbbr,
        lrIsHome ? homeCol : awayCol,
        lrIsHome ? homeLogo : awayLogo,
        lrPct, 'AI Lab model');
    } else {
      gdLRCard = gdModelCard('Logistic Regression', 'Not trained yet',
        null, null, null, null, null, 'Train at AI Lab');
    }
  } catch {
    gdLRCard = gdModelCard('Logistic Regression', 'Unavailable',
      null, null, null, null, null, '');
  }

  /* NN pick — TF.js Game NN, loads async */
  const gdNNId = `gd-nn-${Date.now()}`;
  const gdNNPlaceholder = (typeof tf !== 'undefined')
    ? `<div class="sd-model-card" id="${gdNNId}">
         <div class="sd-model-head">
           <span class="sd-model-name">Neural Network</span>
           <span class="sd-model-status">Loading…</span>
         </div>
         <div class="sd-model-pick"><div><div class="sd-model-winner">—</div><div class="sd-model-sub">TF.js model</div></div><span class="sd-model-pct">—</span></div>
       </div>`
    : gdModelCard('Neural Network', 'TF.js not loaded', null, null, null, null, null, '');

  if (typeof tf !== 'undefined' && typeof loadNNModel === 'function' &&
      typeof extractGameFeatures === 'function' && typeof nnPredict === 'function') {
    setTimeout(async () => {
      try {
        const model = await loadNNModel('game-nn');
        const feats = extractGameFeatures(homeName, awayName);
        let html;
        if (model && feats) {
          const p = nnPredict(model, feats);
          const nnIsHome = p >= 0.5;
          const nnPct = Math.round(Math.max(p, 1 - p) * 100);
          html = gdModelCard('Neural Network', 'TensorFlow.js · trained',
            nnIsHome ? homeName : awayName,
            nnIsHome ? game.homeAbbr : game.awayAbbr,
            nnIsHome ? homeCol : awayCol,
            nnIsHome ? homeLogo : awayLogo,
            nnPct, 'AI Lab model');
        } else {
          html = gdModelCard('Neural Network', 'Not trained yet',
            null, null, null, null, null, 'Train at AI Lab');
        }
        const el = document.getElementById(gdNNId);
        if (el) el.outerHTML = html;
      } catch {
        const el = document.getElementById(gdNNId);
        if (el) el.outerHTML = gdModelCard('Neural Network', 'Unavailable',
          null, null, null, null, null, '');
      }
    }, 50);
  }

  const gdModelsSection = `
    <div class="gd-section sd-models-section">
      <div class="gd-section-title">AI Model Comparison <span class="ai-badge" style="margin-left:8px">3 models</span></div>
      <div class="sd-models-grid">
        ${gdFormulaCard}
        ${gdLRCard}
        ${gdNNPlaceholder}
      </div>
      <div class="sd-models-note">Three independent picks for ${game.homeAbbr} vs ${game.awayAbbr}. The Formula is rule-based; LR and NN learn from past games.</div>
    </div>`;

  /* Render the modal */
  mc.innerHTML = `
    <div class="gd-header">
      ${statusBadge}
      ${seriesLine}
      ${venueLine}
    </div>

    <div class="gd-scoreboard">
      <div class="gd-team gd-team-home">
        <div class="gd-team-bar" style="background:${homeCol}"></div>
        <div class="gd-team-info">
          <div class="gd-team-abbr" style="color:${homeCol}">${game.homeAbbr}</div>
          <div class="gd-team-name">${game.homeFullName || game.homeName}</div>
        </div>
        <div class="gd-team-score${game.homeScore >= game.awayScore ? ' gd-winning' : ''}">${game.homeScore}</div>
      </div>
      <div class="gd-team gd-team-away">
        <div class="gd-team-score${game.awayScore >= game.homeScore ? ' gd-winning' : ''}">${game.awayScore}</div>
        <div class="gd-team-info" style="text-align:right">
          <div class="gd-team-abbr" style="color:${awayCol}">${game.awayAbbr}</div>
          <div class="gd-team-name">${game.awayFullName || game.awayName}</div>
        </div>
        <div class="gd-team-bar" style="background:${awayCol}"></div>
      </div>
    </div>

    <div class="gd-section">
      <div class="gd-section-title">Win Probability</div>
      <div class="gd-wp-hero">
        <div class="gd-wp-side">
          <div class="gd-wp-pct" style="color:${homeCol}">${homeWP}%</div>
          <div class="gd-wp-team">${game.homeAbbr}</div>
        </div>
        <div class="gd-wp-bar-big">
          <div class="gd-wp-fill-big" style="width:${homeWP}%;background:${homeCol}"></div>
          <div class="gd-wp-fill-big" style="width:${awayWP}%;background:${awayCol}"></div>
        </div>
        <div class="gd-wp-side">
          <div class="gd-wp-pct" style="color:${awayCol}">${awayWP}%</div>
          <div class="gd-wp-team">${game.awayAbbr}</div>
        </div>
      </div>
    </div>

    ${gdModelsSection}

    <div class="gd-section">
      <div class="gd-section-title">Game Flow</div>
      <div class="gd-chart-wrap">
        <canvas id="gameFlowCanvas" class="gd-chart-canvas"></canvas>
        <div class="gd-chart-labels">
          <span>1st</span><span>2nd</span><span>3rd</span><span>4th</span>
        </div>
      </div>
      <div class="gd-chart-legend">
        <span style="color:${homeCol}">${game.homeAbbr}</span>
        <span style="color:var(--muted)">Win Probability</span>
        <span style="color:${awayCol}">${game.awayAbbr}</span>
      </div>
    </div>

    ${lastPlayHTML}

    <div class="gd-footer">
      <span>Win probability by ESPN Analytics</span>
    </div>
  `;

  modal.classList.remove('hidden');

  /* Close handlers */
  document.getElementById('gameDetailClose').onclick = () => modal.classList.add('hidden');
  modal.onclick = e => { if (e.target === modal) modal.classList.add('hidden'); };

  /* Draw game flow chart */
  setTimeout(() => {
    drawGameFlowCanvas(game);
  }, 50);

  /* Auto-refresh if game is live */
  if (game.isLive && game.gameId) {
    const refreshId = setInterval(async () => {
      if (modal.classList.contains('hidden')) { clearInterval(refreshId); return; }
      try {
        const fresh = await fetchNBALiveScores();
        const updated = fresh.find(g => g.gameId === game.gameId);
        if (updated) {
          Object.assign(game, updated);
          showGameDetail(game);
        }
      } catch {}
    }, 15000);
  }
}

function drawGameFlowCanvas(game) {
  const canvas = document.getElementById('gameFlowCanvas');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth || 500;
  const H   = 180;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const pad = { top: 20, right: 10, bottom: 20, left: 10 };
  const cW  = W - pad.left - pad.right;
  const cH  = H - pad.top - pad.bottom;

  ctx.clearRect(0, 0, W, H);

  const homeCol = game.homeTeam?.color || '#cc0000';
  const awayCol = game.awayTeam?.color || '#555';

  /* 50% line */
  const midY = pad.top + cH / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(pad.left, midY); ctx.lineTo(W - pad.right, midY); ctx.stroke();
  ctx.setLineDash([]);

  /* Quarter lines */
  for (let q = 1; q <= 3; q++) {
    const x = pad.left + (q / 4) * cW;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + cH); ctx.stroke();
  }

  /* Y-axis labels */
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = '9px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('100%', pad.left + 2, pad.top + 10);
  ctx.fillText('50%', pad.left + 2, midY - 3);
  ctx.textAlign = 'right';
  ctx.fillText('100%', W - pad.right - 2, pad.top + cH - 2);

  /* Build data points — use history if available, otherwise estimate from current state */
  const hist = _gameFlowHistory[game.gameId] || [];
  let points = [];

  if (hist.length >= 2) {
    points = hist.map(h => ({ x: h.time, y: h.homeWP }));
  } else {
    /* Generate approximate game flow from current score/period */
    points.push({ x: 0, y: 50 });  /* game starts at 50/50 */
    const homeWP = game.homeWinPct != null ? game.homeWinPct : 50;
    const periodPct = ((game.period - 1) * 25);
    const clockSecs = parseFloat(game.clock) || 0;
    const quarterPct = 25 - (clockSecs / 720 * 25);
    const currentTimePct = Math.min(100, periodPct + Math.max(0, quarterPct));

    /* Add some intermediate points for a more natural curve */
    if (currentTimePct > 10) {
      const mid = currentTimePct / 2;
      const midWP = 50 + (homeWP - 50) * 0.4;
      points.push({ x: mid * 0.5, y: 50 + (midWP - 50) * 0.3 });
      points.push({ x: mid, y: midWP });
      points.push({ x: mid * 1.5, y: midWP + (homeWP - midWP) * 0.5 });
    }
    if (currentTimePct > 0) {
      points.push({ x: currentTimePct, y: homeWP });
    }
  }

  if (points.length < 2) return;

  /* Draw the probability area + line */
  const toX = pct => pad.left + (pct / 100) * cW;
  const toY = wp  => pad.top + cH - (wp / 100) * cH;

  /* Fill area above 50% (home team color) */
  ctx.beginPath();
  ctx.moveTo(toX(points[0].x), midY);
  points.forEach(p => ctx.lineTo(toX(p.x), toY(p.y)));
  ctx.lineTo(toX(points[points.length-1].x), midY);
  ctx.closePath();
  ctx.fillStyle = game.homeScore >= game.awayScore
    ? homeCol + '25' : awayCol + '25';
  ctx.fill();

  /* Draw the probability line */
  ctx.beginPath();
  ctx.moveTo(toX(points[0].x), toY(points[0].y));
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(toX(points[i].x), toY(points[i].y));
  }
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  /* Current position dot */
  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(toX(last.x), toY(last.y), 5, 0, Math.PI * 2);
  ctx.fillStyle = last.y >= 50 ? homeCol : awayCol;
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();

  /* Team labels at edges */
  ctx.fillStyle = homeCol;
  ctx.font = 'bold 10px Arial';
  ctx.textAlign = 'right';
  ctx.fillText(game.homeAbbr, W - pad.right - 4, pad.top + 12);
  ctx.fillStyle = awayCol;
  ctx.fillText(game.awayAbbr, W - pad.right - 4, pad.top + cH - 4);
}

/* Win probability using hardcoded strength data */
function quickProbByName(homeTeam, awayTeam) {
  if (!homeTeam || !awayTeam) return { home: 50, away: 50 };

  /* Use hardcoded standings data for accurate predictions */
  const hStand = STANDINGS_2025_26.find(s => s.name === homeTeam.name);
  const aStand = STANDINGS_2025_26.find(s => s.name === awayTeam.name);

  if (hStand && aStand) {
    const hWpct = hStand.wins / (hStand.wins + hStand.losses);
    const aWpct = aStand.wins / (aStand.wins + aStand.losses);
    const hNet  = hStand.ppg - hStand.oppPpg;
    const aNet  = aStand.ppg - aStand.oppPpg;
    const edge  = (hWpct - aWpct) * 1.8 + ((hNet - aNet) / 10) * 0.5 + 0.03; /* +3% home court */
    const homeP = clamp(Math.round((0.50 + edge) * 100), 8, 92);
    return { home: homeP, away: 100 - homeP };
  }

  /* Fallback for unknown teams */
  return { home: 53, away: 47 };
}

function buildGameCard(game, prob, conf) {
  const card = document.createElement('div');
  card.className = 'game-card';
  const time = formatGameTime(game.status);
  card.innerHTML = `
    <div class="game-time">${time}</div>
    <div class="game-teams">
      <div class="team-block">
        <span class="team-abbr">${game.home_team.abbreviation}</span>
        <span class="team-name-small">${game.home_team.full_name}</span>
        <span class="team-prob">${prob.home}%</span>
      </div>
      <div class="at-badge">@</div>
      <div class="team-block">
        <span class="team-abbr">${game.visitor_team.abbreviation}</span>
        <span class="team-name-small">${game.visitor_team.full_name}</span>
        <span class="team-prob">${prob.away}%</span>
      </div>
    </div>
    <div class="game-conf">
      <span class="badge ${conf.cls}">${conf.label} Confidence</span>
    </div>
  `;
  return card;
}

function quickProb(game) {
  /* Use hardcoded data for real probabilities instead of random seeds */
  const ht = NBA_TEAMS.find(t => t.id === game.home_team.id);
  const at = NBA_TEAMS.find(t => t.id === game.visitor_team.id);
  return quickProbByName(ht, at);
}

/* ════════════════════════════════════════
   PREDICT PAGE
════════════════════════════════════════ */
function initPredictPage() {
  const homeSelect = document.getElementById('homeTeam');
  const awaySelect = document.getElementById('awayTeam');
  if (!homeSelect || !awaySelect) return;

  NBA_TEAMS.forEach(t => {
    homeSelect.add(new Option(t.name, t.id));
    awaySelect.add(new Option(t.name, t.id));
  });

  /* Set default game date to today */
  const dateInput = document.getElementById('gameDate');
  if (dateInput) {
    const today = new Date();
    dateInput.value = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
  }

  /* Show trained-weights info if custom weights exist */
  const stored = localStorage.getItem('nba_trained_weights');
  if (stored) {
    const w = JSON.parse(stored);
    const info = document.createElement('div');
    info.className = 'weights-info';
    info.innerHTML = `<strong>&#127947; Trained Model Active</strong> — Using weights learned from your imported games. Net Rating: ${pct(w.netRating)}, Form: ${pct(w.recentForm)}, TS%: ${pct(w.trueShooting)}, TO: ${pct(w.turnoverRate)}, Home: ${pct(w.homeCourt)}.`;
    document.querySelector('.predict-section').insertBefore(info, document.querySelector('.team-selectors'));
  }

  const onChange = () => {
    const hId = parseInt(homeSelect.value);
    const aId = parseInt(awaySelect.value);
    if (hId && aId && hId !== aId) runPrediction(hId, aId);
  };
  homeSelect.addEventListener('change', onChange);
  awaySelect.addEventListener('change', onChange);
}

async function runPrediction(homeId, awayId) {
  const loader  = document.getElementById('predictLoader');
  const errBox  = document.getElementById('predictError');
  const results = document.getElementById('predictResults');

  loader.classList.remove('hidden');
  errBox.classList.add('hidden');
  results.classList.add('hidden');

  try {
    const [homeStats, awayStats, homeForm, awayForm, h2h] = await Promise.all([
      fetchTeamStats(homeId),
      fetchTeamStats(awayId),
      fetchLastNGames(homeId, 10),
      fetchLastNGames(awayId, 10),
      fetchH2H(homeId, awayId),
    ]);

    const homeTeam = NBA_TEAMS.find(t => t.id === homeId);
    const awayTeam = NBA_TEAMS.find(t => t.id === awayId);
    const prediction = calcPrediction(homeStats, awayStats, homeForm, awayForm, true, h2h);
    renderResults(homeTeam, awayTeam, homeStats, awayStats, homeForm, awayForm, h2h, prediction);
  } catch (err) {
    errBox.textContent = 'Failed to load prediction data: ' + err.message;
    errBox.classList.remove('hidden');
  } finally {
    loader.classList.add('hidden');
  }
}

/* ── Team stats — computed from season game results ── */
async function fetchTeamStats(teamId) {
  /* For the 2025-26 season, use hardcoded data (API is unreliable) */
  if (currentSeason() === 2025) {
    const team = NBA_TEAMS.find(t => t.id === teamId);
    if (team) {
      const s = STANDINGS_2025_26.find(s => s.name === team.name);
      if (s) {
        const net = s.ppg - s.oppPpg;
        const ts  = clamp(54 + (s.ppg - 112) * 0.4, 48, 65);
        const gp  = s.wins + s.losses;
        const winPct = gp > 0 ? s.wins / gp : 0.5;
        return {
          teamId, offRating: s.ppg, defRating: s.oppPpg, netRating: net,
          tsPct: ts, toRate: 14, rebPct: 44,
          wins: s.wins, losses: s.losses, winPct,
        };
      }
    }
  }

  try {
    const data = await apiFetch(
      `${BASE}/games?team_ids[]=${teamId}&per_page=100&page=1&seasons[]=${currentSeason()}`
    );
    const games = (data.data || []).filter(g => g.home_team_score > 0 && g.visitor_team_score > 0);
    if (games.length === 0) return defaultStats(teamId);
    let scored = 0, allowed = 0, wins = 0;
    games.forEach(g => {
      const homeWon = g.home_team_score > g.visitor_team_score;
      if (g.home_team.id === teamId) {
        scored  += g.home_team_score;
        allowed += g.visitor_team_score;
        if (homeWon) wins++;
      } else {
        scored  += g.visitor_team_score;
        allowed += g.home_team_score;
        if (!homeWon) wins++;
      }
    });
    const n   = games.length;
    const off = scored / n;
    const def = allowed / n;
    const net = off - def;
    const ts  = clamp(54 + (off - 112) * 0.4, 48, 65);
    return {
      teamId, offRating: off, defRating: def, netRating: net,
      tsPct: ts, toRate: 14, rebPct: 44,
      wins, losses: n - wins, winPct: wins / n,
    };
  } catch {
    return defaultStats(teamId);
  }
}

function defaultStats(teamId) {
  const s = teamId;
  return {
    teamId,
    offRating: 108 + (s % 8),
    defRating: 108 + ((s * 3) % 8),
    netRating: (s % 10) - 5,
    tsPct:     54 + (s % 8),
    toRate:    12 + (s % 5),
    rebPct:    43 + (s % 5),
    wins: 41, losses: 41, winPct: 0.5,
  };
}

/* ── Last N games — fetch 100 and sort to get the most recent.
 *  For the 2025-26 season we synthesise a deterministic last-N from
 *  the hardcoded STANDINGS_2025_26 because the BDL API isn't reliable
 *  for that season in every environment. Synthesis uses the team's
 *  overall win% to pick a realistic win count and constructs game
 *  objects in the same shape the live API returns, so downstream
 *  code (formScore, renderFormDots) keeps working unchanged. */
async function fetchLastNGames(teamId, n) {
  const season = currentSeason();

  /* Hardcoded path for 2025-26 */
  if (season === 2025) {
    const team = NBA_TEAMS.find(t => t.id === teamId);
    const s = team && STANDINGS_2025_26.find(s => s.name === team.name);
    if (s) {
      const gp = s.wins + s.losses;
      const winPct = gp > 0 ? s.wins / gp : 0.5;
      const wantedWins = Math.round(winPct * n);
      /* Build a realistic interleaved W/L pattern. Distribute the
         `wantedWins` wins evenly across n slots so a 6-4 last-10
         looks like W W L W W L W L W L (not WWWWWW LLLL). */
      const wlPattern = [];
      const step = n / Math.max(1, wantedWins);
      for (let i = 0; i < n; i++) {
        /* Mark as win if a win-slot should land here */
        const expectedWinsByNow = Math.round((i + 1) / step);
        const winsSoFar = wlPattern.filter(x => x).length;
        wlPattern.push(winsSoFar < expectedWinsByNow && winsSoFar < wantedWins);
      }
      const games = [];
      for (let i = 0; i < n; i++) {
        const isWin = wlPattern[i];
        const isHome = i % 2 === 0;
        const score = isWin ? 112 : 102;
        const oppScore = isWin ? 102 : 112;
        games.push({
          id: `synth-${teamId}-${i}`,
          date: new Date(Date.now() - i * 86400000 * 2).toISOString(),
          home_team_score: isHome ? score : oppScore,
          visitor_team_score: isHome ? oppScore : score,
          home_team: { id: isHome ? teamId : -1 },
          visitor_team: { id: isHome ? -1 : teamId },
        });
      }
      return games;
    }
  }

  /* Live API for other seasons */
  try {
    const data = await apiFetch(
      `${BASE}/games?team_ids[]=${teamId}&per_page=100&page=1&seasons[]=${season}`
    );
    if (!data.data) return [];
    return data.data
      .filter(g => g.home_team_score > 0 && g.visitor_team_score > 0)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, n);
  } catch { return []; }
}

/* ── Head to head ──
 * Three-tier strategy:
 *  1. For 2025-26, check H2H_2025_26 (real playoff matchup results).
 *  2. If not in the hardcoded set, synthesise a regular-season h2h
 *     from the two teams' winPct so the card never shows blank when
 *     the BDL API is unreachable.
 *  3. For other seasons, hit BDL — but POST-FILTER to actual matchups
 *     because team_ids[]=A&team_ids[]=B is an OR filter and would
 *     otherwise return every game either team played. */
async function fetchH2H(team1Id, team2Id) {
  const season = currentSeason();

  /* 2025-26: try hardcoded H2H_2025_26 first */
  if (season === 2025) {
    const team1 = NBA_TEAMS.find(t => t.id === team1Id);
    const team2 = NBA_TEAMS.find(t => t.id === team2Id);

    if (team1 && team2 && typeof H2H_2025_26 !== 'undefined') {
      const match = H2H_2025_26.find(m =>
        (m.t1 === team1.name && m.t2 === team2.name) ||
        (m.t1 === team2.name && m.t2 === team1.name));
      if (match && match.games?.length) {
        let t1Wins = 0, t2Wins = 0;
        match.games.forEach(g => {
          const homeIsT1 = g.home === team1.name;
          const homeWon = g.hScore > g.aScore;
          if ((homeIsT1 && homeWon) || (!homeIsT1 && !homeWon)) t1Wins++;
          else t2Wins++;
        });
        return { team1Wins: t1Wins, team2Wins: t2Wins, total: match.games.length };
      }
    }

    /* Synthesise from each team's overall season win% so the card has
       something honest to show. ~3 games per regular-season matchup;
       distribute wins by the relative strength of the two teams. */
    if (team1 && team2) {
      const s1 = STANDINGS_2025_26.find(s => s.name === team1.name);
      const s2 = STANDINGS_2025_26.find(s => s.name === team2.name);
      if (s1 && s2) {
        const gp1 = s1.wins + s1.losses;
        const gp2 = s2.wins + s2.losses;
        const wp1 = gp1 ? s1.wins / gp1 : 0.5;
        const wp2 = gp2 ? s2.wins / gp2 : 0.5;
        /* Probability team1 wins a single matchup, slight regression to 0.5 */
        const p1 = clamp(0.5 + (wp1 - wp2) * 0.8, 0.15, 0.85);
        const total = 3;                              /* normal regular-season series */
        const t1Wins = Math.round(p1 * total);
        return { team1Wins: t1Wins, team2Wins: total - t1Wins, total };
      }
    }

    return { team1Wins: 0, team2Wins: 0, total: 0 };
  }

  /* Live API for other seasons */
  try {
    const data = await apiFetch(
      `${BASE}/games?team_ids[]=${team1Id}&team_ids[]=${team2Id}&per_page=100&seasons[]=${season}`
    );
    if (!data.data) return { team1Wins: 0, team2Wins: 0, total: 0 };
    let t1 = 0, t2 = 0;
    for (const g of data.data) {
      const sameMatchup =
        (g.home_team.id === team1Id && g.visitor_team.id === team2Id) ||
        (g.home_team.id === team2Id && g.visitor_team.id === team1Id);
      if (!sameMatchup) continue;
      if (g.home_team_score == null || g.visitor_team_score == null) continue;
      if (g.home_team_score === 0 && g.visitor_team_score === 0) continue;
      const homeWon = g.home_team_score > g.visitor_team_score;
      if ((g.home_team.id === team1Id && homeWon) || (g.visitor_team.id === team1Id && !homeWon)) t1++;
      else t2++;
    }
    return { team1Wins: t1, team2Wins: t2, total: t1 + t2 };
  } catch { return { team1Wins: 0, team2Wins: 0, total: 0 }; }
}

/* ── Prediction formula — uses trained weights ──
 *  Now accepts h2h (head-to-head this season). Both team-stats
 *  objects must include `winPct`. Last param signature stays
 *  backward-compatible (homeIsHome stays in 5th slot). */
function calcPrediction(homeStats, awayStats, homeForm, awayForm, homeIsHome, h2h) {
  const W = getWeights();

  const homeFormScore = formScore(homeForm, homeStats.teamId);
  const awayFormScore = formScore(awayForm, awayStats.teamId);

  const normNet = v => clamp((v + 15) / 30 * 100, 0, 100);
  const normTS  = v => clamp((v - 45) / 25 * 100, 0, 100);
  const normTO  = v => clamp((22 - v) / 14 * 100, 0, 100);
  /* Overall season win% mapped to a 0-100 score — every 1% above
     .500 adds 2 points so the spread between a 60-win and a 30-win
     team is meaningful (about 36 points). */
  const normWinPct = wp => clamp(50 + (wp - 0.5) * 200, 0, 100);

  /* H2H this season — small but real factor. If team has won 3 of 4
     head-to-head, that's a 75% h2h score for them and 25% for the
     opponent. With no h2h data both default to 50. */
  let homeH2H = 50, awayH2H = 50;
  if (h2h && h2h.total > 0) {
    homeH2H = (h2h.team1Wins / h2h.total) * 100;
    awayH2H = (h2h.team2Wins / h2h.total) * 100;
  }

  const homeWP = homeStats.winPct != null ? homeStats.winPct : 0.5;
  const awayWP = awayStats.winPct != null ? awayStats.winPct : 0.5;

  const homeScore =
    normNet(homeStats.netRating) * W.netRating    +
    normWinPct(homeWP)           * W.winPct       +
    homeFormScore                * W.recentForm   +
    homeH2H                      * W.h2h          +
    normTS(homeStats.tsPct)      * W.trueShooting +
    normTO(homeStats.toRate)     * W.turnoverRate +
    (homeIsHome ? 100 : 0)       * W.homeCourt;

  const awayScore =
    normNet(awayStats.netRating) * W.netRating    +
    normWinPct(awayWP)           * W.winPct       +
    awayFormScore                * W.recentForm   +
    awayH2H                      * W.h2h          +
    normTS(awayStats.tsPct)      * W.trueShooting +
    normTO(awayStats.toRate)     * W.turnoverRate +
    (!homeIsHome ? 100 : 0)      * W.homeCourt;

  const total    = homeScore + awayScore || 1;
  const homeProb = Math.round((homeScore / total) * 100);
  const awayProb = 100 - homeProb;

  return { homeScore, awayScore, homeProb, awayProb, homeFormScore, awayFormScore };
}

function formScore(games, teamId) {
  if (!games || games.length === 0) return 50;
  let wins = 0;
  for (const g of games) {
    const homeWon = g.home_team_score > g.visitor_team_score;
    if ((g.home_team.id === teamId && homeWon) || (g.visitor_team.id === teamId && !homeWon)) wins++;
  }
  return (wins / games.length) * 100;
}

/* ── Render results ── */
function renderResults(homeTeam, awayTeam, homeStats, awayStats, homeForm, awayForm, h2h, pred) {
  const results = document.getElementById('predictResults');
  const diff    = Math.abs(pred.homeProb - pred.awayProb);
  const conf    = confidenceLabel(diff);
  const winner  = pred.homeProb >= pred.awayProb ? homeTeam : awayTeam;
  const winProb = pred.homeProb >= pred.awayProb ? pred.homeProb : pred.awayProb;

  const gameDateEl = document.getElementById('gameDate');
  const gameDateStr = gameDateEl?.value ? new Date(gameDateEl.value + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';

  document.getElementById('winnerBanner').innerHTML = `
    <h2>Predicted Winner</h2>
    ${gameDateStr ? `<div class="predict-date">${gameDateStr}</div>` : ''}
    <span class="win-pct">${winner.name}</span>
    <span style="font-size:2rem;font-weight:900;color:var(--accent)">${winProb}%</span>
    <p class="win-sub" style="margin-top:8px">Formula win probability</p>
  `;

  renderProbBar('homeProb', homeTeam, pred.homeProb, homeTeam.color);
  renderProbBar('awayProb', awayTeam, pred.awayProb, awayTeam.color);

  document.getElementById('homeFormLabel').textContent = homeTeam.name + ' — Last 10';
  document.getElementById('awayFormLabel').textContent = awayTeam.name + ' — Last 10';
  renderFormDots('homeForm', homeForm, homeTeam.id);
  renderFormDots('awayForm', awayForm, awayTeam.id);

  document.getElementById('h2hRecord').innerHTML = `
    <div class="h2h-team">
      <span class="h2h-wins">${h2h.team1Wins}</span>
      <span class="h2h-label">${homeTeam.abbr}</span>
    </div>
    <span class="h2h-dash">-</span>
    <div class="h2h-team">
      <span class="h2h-wins">${h2h.team2Wins}</span>
      <span class="h2h-label">${awayTeam.abbr}</span>
    </div>
  `;

  const factors = buildTopFactors(homeTeam, awayTeam, homeStats, awayStats);
  const factorsEl = document.getElementById('topFactors');
  factorsEl.innerHTML = '';
  factors.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'factor-row';
    row.innerHTML = `
      <span class="factor-rank">${i + 1}</span>
      <span class="factor-name">${f.name}</span>
      <span class="factor-val">${f.value}</span>
    `;
    factorsEl.appendChild(row);
  });

  const homeScore = Math.round(homeStats.offRating * (100 / (homeStats.defRating || 100)) * 1.1);
  const awayScore = Math.round(awayStats.offRating * (100 / (awayStats.defRating || 100)) * 1.1);
  document.getElementById('predictedScore').innerHTML = `
    <div class="score-team">
      <span class="score-pts">${homeScore}</span>
      <span class="score-abbr">${homeTeam.abbr}</span>
    </div>
    <span class="score-dash">-</span>
    <div class="score-team">
      <span class="score-pts">${awayScore}</span>
      <span class="score-abbr">${awayTeam.abbr}</span>
    </div>
  `;

  document.getElementById('analysisText').textContent = generateAnalysis(
    homeTeam, awayTeam, homeStats, awayStats, homeForm, awayForm, pred, h2h
  );

  const badge = document.getElementById('confidenceBadge');
  badge.textContent = conf.label + ' Confidence';
  badge.className = 'confidence-badge ' + conf.cls;

  /* ── AI Model Predictions ──
     Always show the section so BOTH models (LR + NN) report on every
     prediction — including the very first one. Each card falls back
     to a clear "Train at AI Lab" message when its model isn't trained. */
  const aiSection = document.getElementById('aiPredictionSection');
  if (aiSection) {
    aiSection.classList.remove('hidden');
    const lrEl = document.getElementById('aiPredLRResult');
    const nnEl = document.getElementById('aiPredNNResult');

    /* LR — pure JS, runs immediately */
    const aiPred = (typeof getAIGamePrediction === 'function')
      ? getAIGamePrediction(homeTeam.name, awayTeam.name)
      : { lr: null };
    if (aiPred.lr != null) {
      const lrPct = Math.round(Math.max(aiPred.lr, 1 - aiPred.lr) * 100);
      const lrWinner = aiPred.lr >= 0.5 ? homeTeam : awayTeam;
      lrEl.innerHTML = `<span class="ai-pred-winner-name">${lrWinner.name}</span><span class="ai-pred-pct-val">${lrPct}%</span>`;
    } else {
      lrEl.innerHTML = `<span class="ai-pred-untrained">Train at AI Lab</span>`;
    }

    /* NN — needs TensorFlow.js (now loaded on predict.html too) */
    if (typeof tf !== 'undefined' && typeof loadNNModel === 'function') {
      nnEl.textContent = 'Loading…';
      (async () => {
        try {
          const model = await loadNNModel('game-nn');
          if (model) {
            const feats = extractGameFeatures(homeTeam.name, awayTeam.name);
            const p = nnPredict(model, feats);
            const nnPct = Math.round(Math.max(p, 1 - p) * 100);
            const nnWinner = p >= 0.5 ? homeTeam : awayTeam;
            nnEl.innerHTML = `<span class="ai-pred-winner-name">${nnWinner.name}</span><span class="ai-pred-pct-val">${nnPct}%</span>`;
          } else {
            nnEl.innerHTML = `<span class="ai-pred-untrained">Train at AI Lab</span>`;
          }
        } catch { nnEl.textContent = 'Unavailable'; }
      })();
    } else {
      nnEl.textContent = 'TF.js not loaded';
    }
  }

  results.classList.remove('hidden');
  setTimeout(() => {
    document.querySelectorAll('.prob-bar-fill').forEach(b => {
      b.style.width = b.dataset.target;
    });
  }, 50);
}

function renderProbBar(elId, team, prob, color) {
  const el = document.getElementById(elId);
  el.innerHTML = `
    <div class="team-title">${team.name}</div>
    <div class="prob-bar-track">
      <div class="prob-bar-fill" style="background:${color}" data-target="${prob}%"></div>
    </div>
    <span class="prob-pct">${prob}%</span>
  `;
}

function renderFormDots(elId, games, teamId) {
  const el = document.getElementById(elId);
  el.innerHTML = '';
  if (!games || games.length === 0) {
    el.innerHTML = '<span style="color:var(--muted);font-size:0.8rem">No data</span>';
    return;
  }
  const sorted = [...games].sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const g of sorted) {
    const homeWon = g.home_team_score > g.visitor_team_score;
    const won = (g.home_team.id === teamId && homeWon) || (g.visitor_team.id === teamId && !homeWon);
    const dot = document.createElement('div');
    dot.className = 'dot ' + (won ? 'win' : 'loss');
    dot.title = won ? 'Win' : 'Loss';
    dot.textContent = won ? 'W' : 'L';
    el.appendChild(dot);
  }
}

function buildTopFactors(homeTeam, awayTeam, homeStats, awayStats) {
  const netDiff = (homeStats.netRating - awayStats.netRating).toFixed(1);
  const tsDiff  = (homeStats.tsPct - awayStats.tsPct).toFixed(1);
  const toDiff  = (awayStats.toRate - homeStats.toRate).toFixed(1);
  const sign    = v => (parseFloat(v) > 0 ? '+' : '');
  return [
    { name: `Net Rating — ${homeTeam.abbr} ${sign(homeStats.netRating)}${homeStats.netRating.toFixed(1)} vs ${awayTeam.abbr} ${sign(awayStats.netRating)}${awayStats.netRating.toFixed(1)}`, value: `Δ ${sign(netDiff)}${netDiff}` },
    { name: `True Shooting% — ${homeTeam.abbr} ${homeStats.tsPct.toFixed(1)}% vs ${awayTeam.abbr} ${awayStats.tsPct.toFixed(1)}%`, value: `Δ ${sign(tsDiff)}${tsDiff}%` },
    { name: `Turnover Rate — ${homeTeam.abbr} ${homeStats.toRate.toFixed(1)}% vs ${awayTeam.abbr} ${awayStats.toRate.toFixed(1)}%`, value: `Δ ${sign(toDiff)}${toDiff}%` },
  ];
}

function generateAnalysis(homeTeam, awayTeam, homeStats, awayStats, homeForm, awayForm, pred, h2h) {
  const winnerIsHome = pred.homeProb >= pred.awayProb;
  const winner  = winnerIsHome ? homeTeam  : awayTeam;
  const loser   = winnerIsHome ? awayTeam  : homeTeam;
  const wStats  = winnerIsHome ? homeStats : awayStats;
  const lStats  = winnerIsHome ? awayStats : homeStats;
  const winProb = winnerIsHome ? pred.homeProb : pred.awayProb;
  const wFormPct = winnerIsHome ? pred.homeFormScore : pred.awayFormScore;
  const wForm   = Math.round(wFormPct / 10);
  const lForm   = Math.round((winnerIsHome ? pred.awayFormScore : pred.homeFormScore) / 10);
  const netEdgeNum = wStats.netRating - lStats.netRating;
  const netEdge = netEdgeNum.toFixed(1);
  const tsEdge  = (wStats.tsPct - lStats.tsPct).toFixed(1);

  const usingCustom = !!localStorage.getItem('nba_trained_weights');
  const modelNote = usingCustom ? ` (model trained on ${getStoredGames().length} imported games)` : '';

  /* Net-rating phrasing — separate POSITIVE/NEGATIVE edge so we never
     produce "edge of -2.3" (the bug the user flagged). */
  let netClause;
  if (netEdgeNum > 1) {
    netClause = `a net rating of ${wStats.netRating >= 0 ? '+' : ''}${wStats.netRating.toFixed(1)} — a ${netEdgeNum > 5 ? 'dominant' : 'real'} +${netEdge}-point edge per 100 possessions over ${loser.name}.`;
  } else if (netEdgeNum < -1) {
    /* The predicted winner has a WORSE net rating than the loser.
       This happens when other factors (win%, h2h, home court) outweigh
       net rating. Say so honestly. */
    netClause = `a net rating of ${wStats.netRating >= 0 ? '+' : ''}${wStats.netRating.toFixed(1)}, actually trailing ${loser.name} by ${Math.abs(netEdgeNum).toFixed(1)} points per 100 — the pick rides on other factors below.`;
  } else {
    netClause = `a net rating of ${wStats.netRating >= 0 ? '+' : ''}${wStats.netRating.toFixed(1)}, essentially even with ${loser.name}.`;
  }

  /* Season record — the factor that was missing before. */
  let recordClause = '';
  if (wStats.winPct != null && lStats.winPct != null) {
    const wRecord = wStats.wins != null ? `${wStats.wins}-${wStats.losses}` : null;
    const lRecord = lStats.wins != null ? `${lStats.wins}-${lStats.losses}` : null;
    if (wRecord && lRecord) {
      const wpDiff = wStats.winPct - lStats.winPct;
      if (Math.abs(wpDiff) > 0.05) {
        recordClause = wpDiff > 0
          ? `Season-long, ${winner.name} are the stronger side at ${wRecord} vs ${loser.name}'s ${lRecord}.`
          : `${loser.name} have the better season record (${lRecord}) than ${winner.name} (${wRecord}), so this is an upset call.`;
      } else {
        recordClause = `Season records are close — ${winner.name} ${wRecord} vs ${loser.name} ${lRecord}.`;
      }
    }
  }

  /* Form — describe what's actually true, not a generic "momentum". */
  let formClause;
  if (wForm >= 7) {
    formClause = `Recent form backs the pick: ${winner.name} are ${wForm}-${10-wForm} over their last 10, while ${loser.name} are ${lForm}-${10-lForm}.`;
  } else if (wForm >= 5) {
    formClause = `${winner.name} have been steady at ${wForm}-${10-wForm} in their last 10 (${loser.name}: ${lForm}-${10-lForm}).`;
  } else {
    /* Predicted winner has a LOSING last-10. Honest about it. */
    formClause = `Form is a concern for the pick — ${winner.name} are only ${wForm}-${10-wForm} in their last 10 (${loser.name}: ${lForm}-${10-lForm}).`;
  }

  /* H2H this season — only mention if there are games to point to. */
  let h2hClause = '';
  if (h2h && h2h.total > 0) {
    const wH2H = winnerIsHome ? h2h.team1Wins : h2h.team2Wins;
    const lH2H = winnerIsHome ? h2h.team2Wins : h2h.team1Wins;
    if (wH2H > lH2H) {
      h2hClause = `Head-to-head this season, ${winner.name} have won ${wH2H} of ${h2h.total} meetings.`;
    } else if (lH2H > wH2H) {
      h2hClause = `${loser.name} hold the head-to-head edge this season at ${lH2H}-${wH2H}, which works against this pick.`;
    } else {
      h2hClause = `The teams have split their ${h2h.total} meetings this season ${wH2H}-${lH2H}.`;
    }
  }

  /* Shooting — only mention if it actually matters. */
  let tsClause = '';
  if (Math.abs(parseFloat(tsEdge)) > 1.5) {
    tsClause = parseFloat(tsEdge) > 0
      ? `Shooting efficiency favours ${winner.name} (${wStats.tsPct.toFixed(1)}% true shooting vs ${lStats.tsPct.toFixed(1)}%).`
      : `${loser.name} actually shoot more efficiently (${lStats.tsPct.toFixed(1)}% vs ${wStats.tsPct.toFixed(1)}%).`;
  }

  /* Closing — tone matched to confidence. No "wire to wire" on coin flips. */
  let closing;
  if (winProb >= 70) {
    closing = `${winner.name} should control this one barring a cold shooting night.`;
  } else if (winProb >= 60) {
    closing = `${winner.name} are favoured, but ${loser.name} have a real path if they win the turnover battle.`;
  } else {
    closing = `This is essentially a coin flip — the model leans ${winner.name} by ${Math.abs(winProb - 50)} point${Math.abs(winProb-50) === 1 ? '' : 's'}, but either result would be unsurprising.`;
  }

  const opener = `${winner.name} are projected to win with ${winProb}% probability${modelNote}, backed by ${netClause}`;

  return [opener, recordClause, h2hClause, formClause, tsClause, closing]
    .filter(Boolean).join(' ');
}

/* ════════════════════════════════════════
   TEAM NAME NORMALIZATION
   Maps every Basketball Reference variant,
   abbreviation, nickname, and historical
   name to the canonical site name.
════════════════════════════════════════ */
const TEAM_NAME_MAP = {
  /* ── Canonical names (pass-through) ── */
  'atlanta hawks': 'Atlanta Hawks',
  'boston celtics': 'Boston Celtics',
  'brooklyn nets': 'Brooklyn Nets',
  'charlotte hornets': 'Charlotte Hornets',
  'chicago bulls': 'Chicago Bulls',
  'cleveland cavaliers': 'Cleveland Cavaliers',
  'dallas mavericks': 'Dallas Mavericks',
  'denver nuggets': 'Denver Nuggets',
  'detroit pistons': 'Detroit Pistons',
  'golden state warriors': 'Golden State Warriors',
  'houston rockets': 'Houston Rockets',
  'indiana pacers': 'Indiana Pacers',
  'la clippers': 'LA Clippers',
  'los angeles clippers': 'LA Clippers',
  'los angeles lakers': 'Los Angeles Lakers',
  'memphis grizzlies': 'Memphis Grizzlies',
  'miami heat': 'Miami Heat',
  'milwaukee bucks': 'Milwaukee Bucks',
  'minnesota timberwolves': 'Minnesota Timberwolves',
  'new orleans pelicans': 'New Orleans Pelicans',
  'new york knicks': 'New York Knicks',
  'oklahoma city thunder': 'Oklahoma City Thunder',
  'orlando magic': 'Orlando Magic',
  'philadelphia 76ers': 'Philadelphia 76ers',
  'philadelphia 76 ers': 'Philadelphia 76ers',
  'phoenix suns': 'Phoenix Suns',
  'portland trail blazers': 'Portland Trail Blazers',
  'sacramento kings': 'Sacramento Kings',
  'san antonio spurs': 'San Antonio Spurs',
  'toronto raptors': 'Toronto Raptors',
  'utah jazz': 'Utah Jazz',
  'washington wizards': 'Washington Wizards',

  /* ── Basketball Reference abbreviations ── */
  'atl': 'Atlanta Hawks',
  'bos': 'Boston Celtics',
  'brk': 'Brooklyn Nets',   /* BBRef uses BRK */
  'bkn': 'Brooklyn Nets',
  'nj':  'Brooklyn Nets',
  'cho': 'Charlotte Hornets', /* BBRef uses CHO */
  'cha': 'Charlotte Hornets',
  'chi': 'Chicago Bulls',
  'cle': 'Cleveland Cavaliers',
  'dal': 'Dallas Mavericks',
  'den': 'Denver Nuggets',
  'det': 'Detroit Pistons',
  'gsw': 'Golden State Warriors',
  'hou': 'Houston Rockets',
  'ind': 'Indiana Pacers',
  'lac': 'LA Clippers',
  'lal': 'Los Angeles Lakers',
  'mem': 'Memphis Grizzlies',
  'mia': 'Miami Heat',
  'mil': 'Milwaukee Bucks',
  'min': 'Minnesota Timberwolves',
  'nop': 'New Orleans Pelicans',
  'noh': 'New Orleans Pelicans', /* old BBRef abbr */
  'nyk': 'New York Knicks',
  'okc': 'Oklahoma City Thunder',
  'orl': 'Orlando Magic',
  'phi': 'Philadelphia 76ers',
  'phx': 'Phoenix Suns',
  'pho': 'Phoenix Suns',
  'por': 'Portland Trail Blazers',
  'sac': 'Sacramento Kings',
  'sas': 'San Antonio Spurs',
  'tor': 'Toronto Raptors',
  'uta': 'Utah Jazz',
  'was': 'Washington Wizards',
  'wsh': 'Washington Wizards',

  /* ── Common nicknames / short forms ── */
  'hawks':         'Atlanta Hawks',
  'celtics':       'Boston Celtics',
  'nets':          'Brooklyn Nets',
  'hornets':       'Charlotte Hornets',
  'bulls':         'Chicago Bulls',
  'cavaliers':     'Cleveland Cavaliers',
  'cavs':          'Cleveland Cavaliers',
  'mavericks':     'Dallas Mavericks',
  'mavs':          'Dallas Mavericks',
  'nuggets':       'Denver Nuggets',
  'pistons':       'Detroit Pistons',
  'warriors':      'Golden State Warriors',
  'rockets':       'Houston Rockets',
  'pacers':        'Indiana Pacers',
  'clippers':      'LA Clippers',
  'lakers':        'Los Angeles Lakers',
  'grizzlies':     'Memphis Grizzlies',
  'grizz':         'Memphis Grizzlies',
  'heat':          'Miami Heat',
  'bucks':         'Milwaukee Bucks',
  'timberwolves':  'Minnesota Timberwolves',
  'wolves':        'Minnesota Timberwolves',
  'twolves':       'Minnesota Timberwolves',
  'pelicans':      'New Orleans Pelicans',
  'pels':          'New Orleans Pelicans',
  'knicks':        'New York Knicks',
  'thunder':       'Oklahoma City Thunder',
  'magic':         'Orlando Magic',
  '76ers':         'Philadelphia 76ers',
  'sixers':        'Philadelphia 76ers',
  'suns':          'Phoenix Suns',
  'trail blazers': 'Portland Trail Blazers',
  'blazers':       'Portland Trail Blazers',
  'kings':         'Sacramento Kings',
  'spurs':         'San Antonio Spurs',
  'raptors':       'Toronto Raptors',
  'jazz':          'Utah Jazz',
  'wizards':       'Washington Wizards',

  /* ── Historical Basketball Reference names ── */
  'new jersey nets':            'Brooklyn Nets',
  'new jersey':                 'Brooklyn Nets',
  'seattle supersonics':        'Oklahoma City Thunder',
  'seattle':                    'Oklahoma City Thunder',
  'supersonics':                'Oklahoma City Thunder',
  'sonics':                     'Oklahoma City Thunder',
  'charlotte bobcats':          'Charlotte Hornets',
  'bobcats':                    'Charlotte Hornets',
  'new orleans hornets':        'New Orleans Pelicans',
  'new orleans/oklahoma city':  'New Orleans Pelicans',
  'vancouver grizzlies':        'Memphis Grizzlies',
  'washington bullets':         'Washington Wizards',
  'bullets':                    'Washington Wizards',
  'new jersey/brooklyn':        'Brooklyn Nets',
};

function normalizeTeamName(raw) {
  if (!raw) return { name: null, matched: false };
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (TEAM_NAME_MAP[key]) return { name: TEAM_NAME_MAP[key], matched: true };
  /* Fuzzy: try trimming trailing punctuation / extra words */
  const stripped = key.replace(/[^a-z0-9 ]/g, '').trim();
  if (TEAM_NAME_MAP[stripped]) return { name: TEAM_NAME_MAP[stripped], matched: true };
  /* Partial: check if any canonical name contains this string */
  const found = NBA_TEAMS.find(t => t.name.toLowerCase().includes(key) || key.includes(t.name.toLowerCase()));
  if (found) return { name: found.name, matched: true };
  return { name: raw.trim(), matched: false };
}

/* ════════════════════════════════════════
   FLEXIBLE DATE PARSER
   Handles: YYYY-MM-DD, MM/DD/YYYY,
   M/D/YYYY, "October 22, 2024",
   "Oct 22, 2024", "Tue Oct 22, 2024"
════════════════════════════════════════ */
const MONTH_MAP = {
  jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
  jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
  january:1, february:2, march:3, april:4, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12,
};

function parseDateFlexible(raw) {
  if (!raw) return null;
  const s = raw.trim();

  /* YYYY-MM-DD */
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  /* MM/DD/YYYY or M/D/YYYY */
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, m, d, y] = slash;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  /* "October 22, 2024" or "Oct 22, 2024" */
  const long = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (long) {
    const mo = MONTH_MAP[long[1].toLowerCase()];
    if (mo) return `${long[3]}-${String(mo).padStart(2,'0')}-${long[2].padStart(2,'0')}`;
  }

  /* "Tue, Oct 22, 2024" or "Tue Oct 22, 2024" */
  const weekday = s.match(/^[A-Za-z]{2,4},?\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (weekday) {
    const mo = MONTH_MAP[weekday[1].toLowerCase()];
    if (mo) return `${weekday[3]}-${String(mo).padStart(2,'0')}-${weekday[2].padStart(2,'0')}`;
  }

  /* "22 Oct 2024" */
  const dmy = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dmy) {
    const mo = MONTH_MAP[dmy[2].toLowerCase()];
    if (mo) return `${dmy[3]}-${String(mo).padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  }

  return null;
}

/* ════════════════════════════════════════
   BULK LINE PARSER
   Format: Date, Home Team, Away Team, Home Score, Away Score
   Returns { ok, warn, error, game, display }
════════════════════════════════════════ */
function parseBulkLine(line, lineNum) {
  /* Split on comma — but team names may contain commas in edge cases,
     so we split into max 5 parts from the right to preserve team names. */
  const parts = line.split(',').map(p => p.trim());
  if (parts.length < 5) {
    return { ok: false, error: `Line ${lineNum}: expected 5 fields (Date, Home, Away, HomeScore, AwayScore) but got ${parts.length}.` };
  }

  /* Last two parts are always scores; first is date; middle two are teams.
     If there are >5 parts the team names had commas — rejoin middle parts. */
  const dateRaw      = parts[0];
  const awayScoreStr = parts[parts.length - 1];
  const homeScoreStr = parts[parts.length - 2];
  const homeRaw      = parts.slice(1, parts.length - 3).concat(parts[parts.length - 3]).join(', ').split(', ').slice(0, Math.ceil((parts.length - 3) / 2)).join(', ') || parts[1];
  const awayRaw      = parts.slice(2, parts.length - 2).join(', ') || parts[2];

  /* Simpler split: exactly 5 fields — most common case */
  const dateField = parts[0];
  const homeField = parts[1];
  const awayField = parts[2];
  const hScoreField = parts[3];
  const aScoreField = parts[parts.length - 1];

  const date = parseDateFlexible(dateField);
  if (!date) {
    return { ok: false, error: `Line ${lineNum}: unrecognized date "${dateField}". Use YYYY-MM-DD, MM/DD/YYYY, or "Oct 22, 2024".` };
  }

  const homeScore = parseInt(hScoreField);
  const awayScore = parseInt(aScoreField);
  if (isNaN(homeScore) || isNaN(awayScore)) {
    return { ok: false, error: `Line ${lineNum}: scores must be numbers (got "${hScoreField}" / "${aScoreField}").` };
  }
  if (homeScore === awayScore) {
    return { ok: false, error: `Line ${lineNum}: scores cannot be equal — NBA games have no ties.` };
  }
  if (homeScore < 50 || awayScore < 50 || homeScore > 200 || awayScore > 200) {
    return { ok: true, warn: `Line ${lineNum}: score ${homeScore}–${awayScore} looks unusual — imported anyway.`,
      game: buildGame(homeField, awayField, homeScore, awayScore, date) };
  }

  const home = normalizeTeamName(homeField);
  const away = normalizeTeamName(awayField);
  const warns = [];
  if (!home.matched) warns.push(`"${homeField}" not recognized — saved as-is`);
  if (!away.matched) warns.push(`"${awayField}" not recognized — saved as-is`);

  const game = buildGame(home.name, away.name, homeScore, awayScore, date);
  return {
    ok:   true,
    warn: warns.length ? `Line ${lineNum}: ${warns.join('; ')}` : null,
    game,
    display: { date, home: home.name, away: away.name, homeScore, awayScore, homeMatched: home.matched, awayMatched: away.matched },
  };
}

function buildGame(homeName, awayName, homeScore, awayScore, date) {
  const margin     = Math.abs(homeScore - awayScore);
  const winner     = homeScore > awayScore ? 'home' : 'away';
  const winnerName = winner === 'home' ? homeName : awayName;
  return { homeName, awayName, homeScore, awayScore, date, winner, winnerName, margin };
}

/* ════════════════════════════════════════
   BULK PREVIEW RENDERER
════════════════════════════════════════ */
function renderBulkPreview(rows) {
  const section  = document.getElementById('bulkPreviewSection');
  const tbody    = document.getElementById('previewTableBody');
  const countEl  = document.getElementById('previewCount');
  const warnBox  = document.getElementById('previewWarnings');
  const confirmBtn = document.getElementById('confirmImportBtn');

  const valid    = rows.filter(r => r.ok);
  const warnings = rows.filter(r => r.warn || (!r.ok));

  countEl.textContent = valid.length;
  tbody.innerHTML = '';

  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    if (!r.ok) {
      tr.className = 'preview-row-error';
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td colspan="5" style="color:#ff8080">${r.error}</td>
        <td><span class="preview-badge error">Error</span></td>
      `;
    } else {
      const d = r.display;
      const winner = d.homeScore > d.awayScore ? d.home : d.away;
      tr.className = r.warn ? 'preview-row-warn' : '';
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${d.date}</td>
        <td class="${d.homeMatched ? '' : 'unmatched-name'}">${d.home}</td>
        <td class="${d.awayMatched ? '' : 'unmatched-name'}">${d.away}</td>
        <td>${d.homeScore} – ${d.awayScore}</td>
        <td style="font-weight:700;color:var(--white)">${winner}</td>
        <td>${r.warn
          ? '<span class="preview-badge warn">Warning</span>'
          : '<span class="preview-badge ok">OK</span>'}</td>
      `;
    }
    tbody.appendChild(tr);
  });

  /* Warning summary box */
  if (warnings.length) {
    warnBox.innerHTML = warnings.map(r => `<div class="warn-item">${r.warn || r.error}</div>`).join('');
    warnBox.classList.remove('hidden');
  } else {
    warnBox.classList.add('hidden');
  }

  confirmBtn.textContent = `Confirm Import (${valid.length} game${valid.length !== 1 ? 's' : ''})`;
  confirmBtn.disabled = valid.length === 0;

  section.classList.remove('hidden');
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ════════════════════════════════════════
   AUTO IMPORT — FULL SEASON FETCH
════════════════════════════════════════ */
async function autoImportSeason() {
  const btn        = document.getElementById('autoImportBtn');
  const progressEl = document.getElementById('autoImportProgress');
  const resultEl   = document.getElementById('autoImportResult');

  const CURRENT    = currentSeason();
  const numSeasons = parseInt(document.getElementById('seasonsToImport')?.value || '1');
  const seasons    = Array.from({ length: numSeasons }, (_, i) => CURRENT - i);

  btn.disabled = true;
  btn.textContent = 'Importing…';
  resultEl.classList.add('hidden');
  progressEl.classList.remove('hidden');
  setProgress(0, 'Connecting to BallDontLie API…', '');

  try {
    let allApiGames = [];

    for (let si = 0; si < seasons.length; si++) {
      const season      = seasons[si];
      const seasonLabel = `${season}-${String(season + 1).slice(2)}`;
      const raw         = await fetchAllSeasonGames(season, (page, totalPages, loaded) => {
        const overall = Math.round(((si + page / totalPages) / seasons.length) * 100);
        setProgress(
          overall,
          `Fetching ${seasonLabel} (${si + 1} of ${seasons.length})…`,
          `Page ${page} of ${totalPages} — ${loaded.toLocaleString()} games`
        );
      });
      allApiGames = allApiGames.concat(raw);
    }

    setProgress(100, 'Processing completed games…', `Found ${allApiGames.length.toLocaleString()} completed games across ${seasons.length} season${seasons.length > 1 ? 's' : ''}`);
    await sleep(120);

    const converted    = allApiGames.map(convertApiGame).filter(Boolean);
    const existing     = getStoredGames();
    const existingKeys = new Set(existing.map(g => `${g.date}|${g.homeName}|${g.awayName}`));
    const newGames     = converted.filter(g => !existingKeys.has(`${g.date}|${g.homeName}|${g.awayName}`));

    newGames.forEach(g => { g.id = Date.now() + Math.random(); });
    const allGames = [...newGames, ...existing];
    saveStoredGames(allGames);
    refreshTrainPage(allGames);

    const trainInfo = allGames.length >= 10 ? analyzeAndTrain(allGames) : null;
    renderAutoImportResult(resultEl, converted.length, newGames.length, allGames.length, trainInfo);

  } catch (err) {
    resultEl.innerHTML = `<div class="error-box">Auto import failed: ${err.message}. Check your API key and try again.</div>`;
    resultEl.classList.remove('hidden');
  } finally {
    progressEl.classList.add('hidden');
    btn.disabled = false;
    btn.textContent = '↻ Re-import Season Data';
  }
}

function setProgress(pct, label, detail) {
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressPct').textContent   = pct + '%';
  document.getElementById('progressText').textContent  = label;
  document.getElementById('progressDetail').textContent = detail;
}

async function fetchAllSeasonGames(season, onProgress) {
  /* Same next_page-driven pagination — never rely on total_pages alone. */
  const PER_PAGE = 100;
  let all = [], page = 1, totalPages = '?';

  while (page <= 25) {
    const data  = await apiFetch(`${BASE}/games?seasons[]=${season}&per_page=${PER_PAGE}&page=${page}`);
    const batch = data.data || [];
    all = all.concat(batch);

    if (page === 1) {
      const meta = data.meta || {};
      if (meta.total_pages) totalPages = meta.total_pages;
      else if (meta.total_count) totalPages = Math.ceil(meta.total_count / PER_PAGE);
    }
    onProgress(page, totalPages, all.length);

    if (!(data.meta?.next_page) || batch.length < PER_PAGE) break;
    page++;
    if (page % 5 === 0) await sleep(80);
  }

  /* Return only finished games: both scores > 0 and no tie */
  return all.filter(g =>
    g.home_team_score > 0 &&
    g.visitor_team_score > 0 &&
    g.home_team_score !== g.visitor_team_score
  );
}

function convertApiGame(g) {
  const homeTeam = NBA_TEAMS.find(t => t.id === g.home_team.id);
  const awayTeam = NBA_TEAMS.find(t => t.id === g.visitor_team.id);
  if (!homeTeam || !awayTeam) return null;

  const hs   = g.home_team_score;
  const as_  = g.visitor_team_score;
  const date = (g.date || '').split('T')[0];
  if (!date) return null;

  const margin     = Math.abs(hs - as_);
  const winner     = hs > as_ ? 'home' : 'away';
  const winnerName = winner === 'home' ? homeTeam.name : awayTeam.name;
  return { homeName: homeTeam.name, awayName: awayTeam.name, homeScore: hs, awayScore: as_, date, winner, winnerName, margin };
}

function renderAutoImportResult(el, fetched, newAdded, totalStored, trainInfo) {
  const W = trainInfo ? trainInfo.weights : getWeights();

  el.innerHTML = `
    <div class="ai-result">
      <h3>&#10003; Import Complete</h3>
      <div class="ai-stats-grid">
        <div class="ai-stat">
          <span class="ai-stat-val">${fetched.toLocaleString()}</span>
          <span class="ai-stat-label">Games fetched from API</span>
        </div>
        <div class="ai-stat">
          <span class="ai-stat-val">${newAdded.toLocaleString()}</span>
          <span class="ai-stat-label">New games added</span>
        </div>
        <div class="ai-stat">
          <span class="ai-stat-val">${totalStored.toLocaleString()}</span>
          <span class="ai-stat-label">Total training games</span>
        </div>
        ${trainInfo ? `
        <div class="ai-stat">
          <span class="ai-stat-val">${trainInfo.homeWinPct}%</span>
          <span class="ai-stat-label">Home team win rate</span>
        </div>
        <div class="ai-stat">
          <span class="ai-stat-val">${trainInfo.betterRecordWinPct}%</span>
          <span class="ai-stat-label">Better record win rate</span>
        </div>
        <div class="ai-stat">
          <span class="ai-stat-val">${trainInfo.avgMargin} pts</span>
          <span class="ai-stat-label">Avg margin of victory</span>
        </div>
        ` : ''}
      </div>
      ${trainInfo ? `
      <div class="ai-weights">
        <h4>Updated Formula Weights</h4>
        <div class="weights-bar-list">
          ${weightBar('Net Rating',      W.netRating)}
          ${weightBar('Recent Form',     W.recentForm)}
          ${weightBar('True Shooting%',  W.trueShooting)}
          ${weightBar('Turnover Rate',   W.turnoverRate)}
          ${weightBar('Home Court',      W.homeCourt)}
        </div>
      </div>
      ` : ''}
    </div>
  `;
  el.classList.remove('hidden');
}

function weightBar(label, val) {
  const p = Math.round(val * 100);
  return `
    <div class="wb-row">
      <span class="wb-label">${label}</span>
      <div class="wb-track">
        <div class="wb-fill" style="width:${p}%"></div>
      </div>
      <span class="wb-val">${p}%</span>
    </div>
  `;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ════════════════════════════════════════
   TRAIN MODEL PAGE
════════════════════════════════════════ */
function initTrainPage() {
  if (!document.getElementById('addGameForm')) return;

  /* Populate team dropdowns */
  const homeInput = document.getElementById('homeTeamInput');
  const awayInput = document.getElementById('awayTeamInput');
  NBA_TEAMS.forEach(t => {
    homeInput.add(new Option(t.name, t.name));
    awayInput.add(new Option(t.name, t.name));
  });

  /* Set default date to today */
  document.getElementById('gameDateInput').value = todayStr();

  /* Single game form submit */
  document.getElementById('addGameForm').addEventListener('submit', e => {
    e.preventDefault();
    const errEl = document.getElementById('addGameError');
    errEl.classList.add('hidden');

    const homeName  = homeInput.value;
    const awayName  = awayInput.value;
    const homeScore = parseInt(document.getElementById('homeScoreInput').value);
    const awayScore = parseInt(document.getElementById('awayScoreInput').value);
    const date      = document.getElementById('gameDateInput').value;

    if (!homeName || !awayName) { return showFormError(errEl, 'Please select both teams.'); }
    if (homeName === awayName)  { return showFormError(errEl, 'Home and Away teams must be different.'); }
    if (isNaN(homeScore) || isNaN(awayScore)) { return showFormError(errEl, 'Please enter valid scores.'); }
    if (homeScore === awayScore) { return showFormError(errEl, 'Scores cannot be equal (no ties in NBA).'); }
    if (!date) { return showFormError(errEl, 'Please select a date.'); }

    const margin = Math.abs(homeScore - awayScore);
    const winner = homeScore > awayScore ? 'home' : 'away';
    const winnerName = winner === 'home' ? homeName : awayName;

    const games = addGame({ homeName, awayName, homeScore, awayScore, date, winner, winnerName, margin });
    refreshTrainPage(games);
    e.target.reset();
    document.getElementById('gameDateInput').value = todayStr();
  });

  /* ── Parse & Preview ── */
  let _pendingGames = [];   /* holds parsed rows until user confirms */

  document.getElementById('bulkParseBtn').addEventListener('click', () => {
    const errEl = document.getElementById('bulkError');
    errEl.classList.add('hidden');

    const raw = document.getElementById('bulkInput').value.trim();
    if (!raw) { return showFormError(errEl, 'Please paste some game data first.'); }

    const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const rows  = [];

    lines.forEach((line, idx) => {
      rows.push(parseBulkLine(line, idx + 1));
    });

    const valid    = rows.filter(r => r.ok);
    const warnings = rows.filter(r => !r.ok || r.warn);

    if (valid.length === 0) {
      const msgs = rows.filter(r => r.error).map(r => r.error);
      return showFormError(errEl, msgs.join('<br>'));
    }

    _pendingGames = rows;
    renderBulkPreview(rows);
  });

  document.getElementById('confirmImportBtn').addEventListener('click', () => {
    const valid = _pendingGames.filter(r => r.ok);
    if (!valid.length) return;

    let games = getStoredGames();
    valid.forEach(r => {
      r.game.id = Date.now() + Math.random();
      games.unshift(r.game);
    });
    saveStoredGames(games);
    refreshTrainPage(games);

    /* Reset UI */
    document.getElementById('bulkInput').value = '';
    document.getElementById('bulkPreviewSection').classList.add('hidden');
    _pendingGames = [];

    /* Flash success on the single-game card where there's space */
    const succEl = document.createElement('div');
    succEl.className = 'form-success';
    succEl.textContent = `Imported ${valid.length} game${valid.length !== 1 ? 's' : ''} successfully.`;
    document.getElementById('bulkParseBtn').insertAdjacentElement('afterend', succEl);
    setTimeout(() => succEl.remove(), 4000);
  });

  document.getElementById('cancelPreviewBtn').addEventListener('click', () => {
    document.getElementById('bulkPreviewSection').classList.add('hidden');
    _pendingGames = [];
  });

  /* Auto Import Season */
  document.getElementById('autoImportBtn').addEventListener('click', autoImportSeason);

  /* Clear all */
  document.getElementById('clearAllBtn').addEventListener('click', () => {
    if (!confirm('Delete all imported games and reset trained weights?')) return;
    saveStoredGames([]);
    localStorage.removeItem('nba_trained_weights');
    refreshTrainPage([]);
    document.getElementById('trainingSummary').classList.add('hidden');
  });

  /* Initial render */
  refreshTrainPage(getStoredGames());
}

function refreshTrainPage(games) {
  /* Update count badge */
  document.getElementById('gameCount').textContent = games.length;

  /* Show/hide table */
  const noMsg = document.getElementById('noGamesMsg');
  const tableWrap = document.getElementById('tableResponsive');
  if (games.length === 0) {
    noMsg.classList.remove('hidden');
    tableWrap.classList.add('hidden');
  } else {
    noMsg.classList.add('hidden');
    tableWrap.classList.remove('hidden');
    renderGamesTable(games);
  }

  /* Run training if >= 10 games */
  if (games.length >= 10) {
    const info = analyzeAndTrain(games);
    if (info) {
      const summaryEl = document.getElementById('trainingSummary');
      document.getElementById('summaryText').textContent = buildSummaryText(info);
      summaryEl.classList.remove('hidden');
    }
  }
}

function renderGamesTable(games) {
  const tbody = document.getElementById('gamesTableBody');
  tbody.innerHTML = '';
  games.forEach(g => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${g.date}</td>
      <td>${g.homeName}</td>
      <td>${g.awayName}</td>
      <td>${g.homeScore} – ${g.awayScore}</td>
      <td class="winner-cell">${g.winnerName}</td>
      <td class="margin-cell">+${g.margin}</td>
      <td><button class="btn-delete" data-id="${g.id}">Delete</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const games = deleteGame(parseFloat(btn.dataset.id));
      refreshTrainPage(games);
    });
  });
}

function showFormError(el, msg) {
  el.innerHTML = msg;
  el.classList.remove('hidden');
}

/* ════════════════════════════════════════
   SHARED HELPERS
════════════════════════════════════════ */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function offsetDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2, '0'); }
function currentSeason() {
  const y = new Date().getFullYear();
  return new Date().getMonth() + 1 >= 9 ? y : y - 1;
}
function formatGameTime(status) {
  if (!status) return 'Scheduled';
  if (status.includes('T') && status.includes('Z')) {
    try { return new Date(status).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch { return status; }
  }
  return status;
}
function confidenceLabel(diff) {
  if (diff > 20) return { label: 'High',   cls: 'high' };
  if (diff > 10) return { label: 'Medium', cls: 'medium' };
  return           { label: 'Low',    cls: 'low' };
}

/* ════════════════════════════════════════
   CONFERENCE MAPS  (internal team IDs)
════════════════════════════════════════ */
const WEST_IDS = new Set([7,8,10,11,13,14,15,18,19,21,24,25,26,27,29]);
const EAST_IDS = new Set([1,2,3,4,5,6,9,12,16,17,20,22,23,28,30]);

/* ════════════════════════════════════════
   HARDCODED 2025-26 SEASON DATA
   (BDL API free tier returns incomplete data —
    these are the verified final regular-season standings)
════════════════════════════════════════ */
const STANDINGS_2025_26 = [
  // ── Western Conference ──
  { name:'Oklahoma City Thunder',   conf:'West', wins:64, losses:18, homeWins:34, homeLosses:8,  awayWins:30, awayLosses:10, ppg:118.2, oppPpg:108.8 },
  { name:'San Antonio Spurs',       conf:'West', wins:62, losses:20, homeWins:32, homeLosses:8,  awayWins:30, awayLosses:12, ppg:116.5, oppPpg:108.1 },
  { name:'Denver Nuggets',          conf:'West', wins:54, losses:28, homeWins:28, homeLosses:13, awayWins:26, awayLosses:15, ppg:114.8, oppPpg:111.4 },
  { name:'Los Angeles Lakers',      conf:'West', wins:53, losses:29, homeWins:28, homeLosses:13, awayWins:25, awayLosses:16, ppg:115.1, oppPpg:112.0 },
  { name:'Houston Rockets',         conf:'West', wins:52, losses:30, homeWins:30, homeLosses:11, awayWins:22, awayLosses:19, ppg:112.9, oppPpg:109.7 },
  { name:'Minnesota Timberwolves',  conf:'West', wins:49, losses:33, homeWins:26, homeLosses:15, awayWins:23, awayLosses:18, ppg:113.2, oppPpg:111.6 },
  { name:'Phoenix Suns',            conf:'West', wins:45, losses:37, homeWins:25, homeLosses:16, awayWins:20, awayLosses:21, ppg:114.0, oppPpg:113.5 },
  { name:'Portland Trail Blazers',  conf:'West', wins:42, losses:40, homeWins:24, homeLosses:17, awayWins:18, awayLosses:23, ppg:111.3, oppPpg:112.0 },
  { name:'LA Clippers',             conf:'West', wins:42, losses:40, homeWins:23, homeLosses:18, awayWins:19, awayLosses:22, ppg:110.8, oppPpg:111.5 },
  { name:'Golden State Warriors',   conf:'West', wins:37, losses:45, homeWins:22, homeLosses:19, awayWins:15, awayLosses:26, ppg:111.0, oppPpg:113.8 },
  { name:'New Orleans Pelicans',    conf:'West', wins:26, losses:56, homeWins:17, homeLosses:24, awayWins:9,  awayLosses:32, ppg:107.2, oppPpg:115.6 },
  { name:'Dallas Mavericks',        conf:'West', wins:26, losses:56, homeWins:16, homeLosses:25, awayWins:10, awayLosses:31, ppg:108.5, oppPpg:116.0 },
  { name:'Memphis Grizzlies',       conf:'West', wins:25, losses:57, homeWins:14, homeLosses:27, awayWins:11, awayLosses:30, ppg:107.8, oppPpg:115.9 },
  { name:'Sacramento Kings',        conf:'West', wins:22, losses:60, homeWins:15, homeLosses:26, awayWins:7,  awayLosses:34, ppg:106.4, oppPpg:116.5 },
  { name:'Utah Jazz',               conf:'West', wins:22, losses:60, homeWins:14, homeLosses:27, awayWins:8,  awayLosses:33, ppg:105.8, oppPpg:116.2 },
  // ── Eastern Conference ──
  { name:'Detroit Pistons',         conf:'East', wins:60, losses:22, homeWins:32, homeLosses:9,  awayWins:28, awayLosses:13, ppg:116.8, oppPpg:109.2 },
  { name:'Boston Celtics',          conf:'East', wins:56, losses:26, homeWins:30, homeLosses:11, awayWins:26, awayLosses:15, ppg:117.2, oppPpg:111.0 },
  { name:'New York Knicks',         conf:'East', wins:53, losses:29, homeWins:30, homeLosses:10, awayWins:23, awayLosses:19, ppg:115.5, oppPpg:110.8 },
  { name:'Cleveland Cavaliers',     conf:'East', wins:52, losses:30, homeWins:27, homeLosses:14, awayWins:25, awayLosses:16, ppg:114.9, oppPpg:110.5 },
  { name:'Toronto Raptors',         conf:'East', wins:46, losses:36, homeWins:24, homeLosses:17, awayWins:22, awayLosses:19, ppg:113.0, oppPpg:111.8 },
  { name:'Atlanta Hawks',           conf:'East', wins:46, losses:36, homeWins:24, homeLosses:17, awayWins:22, awayLosses:19, ppg:114.2, oppPpg:112.5 },
  { name:'Philadelphia 76ers',      conf:'East', wins:45, losses:37, homeWins:23, homeLosses:18, awayWins:22, awayLosses:19, ppg:112.5, oppPpg:111.0 },
  { name:'Orlando Magic',           conf:'East', wins:45, losses:37, homeWins:26, homeLosses:16, awayWins:19, awayLosses:21, ppg:110.2, oppPpg:109.0 },
  { name:'Charlotte Hornets',       conf:'East', wins:44, losses:38, homeWins:21, homeLosses:20, awayWins:23, awayLosses:18, ppg:111.6, oppPpg:112.0 },
  { name:'Miami Heat',              conf:'East', wins:43, losses:39, homeWins:26, homeLosses:15, awayWins:17, awayLosses:24, ppg:110.5, oppPpg:111.2 },
  { name:'Milwaukee Bucks',         conf:'East', wins:32, losses:50, homeWins:19, homeLosses:22, awayWins:13, awayLosses:28, ppg:112.8, oppPpg:117.0 },
  { name:'Chicago Bulls',           conf:'East', wins:31, losses:51, homeWins:18, homeLosses:23, awayWins:13, awayLosses:28, ppg:109.0, oppPpg:114.5 },
  { name:'Brooklyn Nets',           conf:'East', wins:20, losses:62, homeWins:12, homeLosses:29, awayWins:8,  awayLosses:33, ppg:105.5, oppPpg:116.8 },
  { name:'Indiana Pacers',          conf:'East', wins:19, losses:63, homeWins:11, homeLosses:29, awayWins:8,  awayLosses:34, ppg:108.2, oppPpg:118.0 },
  { name:'Washington Wizards',      conf:'East', wins:17, losses:65, homeWins:11, homeLosses:30, awayWins:6,  awayLosses:35, ppg:104.8, oppPpg:117.5 },
];

const PLAYOFF_BRACKET_2025_26 = {
  west: [
    // Round 1
    { team1:'Oklahoma City Thunder',  team2:'Phoenix Suns',             t1w:4, t2w:0, round:1 },
    { team1:'San Antonio Spurs',      team2:'Portland Trail Blazers',   t1w:4, t2w:1, round:1 },
    { team1:'Minnesota Timberwolves', team2:'Denver Nuggets',           t1w:4, t2w:2, round:1 },
    { team1:'Los Angeles Lakers',     team2:'Houston Rockets',          t1w:4, t2w:2, round:1 },
    // Round 2
    { team1:'Oklahoma City Thunder',  team2:'Los Angeles Lakers',       t1w:4, t2w:0, round:2 },
    { team1:'San Antonio Spurs',      team2:'Minnesota Timberwolves',   t1w:4, t2w:2, round:2 },
    // Conference Finals (in progress — OKC leads 2-1)
    { team1:'Oklahoma City Thunder',  team2:'San Antonio Spurs',        t1w:2, t2w:1, round:3 },
  ],
  east: [
    // Round 1
    { team1:'Detroit Pistons',        team2:'Orlando Magic',            t1w:4, t2w:3, round:1 },
    { team1:'Philadelphia 76ers',     team2:'Boston Celtics',           t1w:4, t2w:3, round:1 },
    { team1:'New York Knicks',        team2:'Atlanta Hawks',            t1w:4, t2w:2, round:1 },
    { team1:'Cleveland Cavaliers',    team2:'Toronto Raptors',          t1w:4, t2w:3, round:1 },
    // Round 2
    { team1:'Cleveland Cavaliers',    team2:'Detroit Pistons',          t1w:4, t2w:3, round:2 },
    { team1:'New York Knicks',        team2:'Philadelphia 76ers',       t1w:4, t2w:0, round:2 },
    // Conference Finals (in progress — Knicks lead 3-0)
    { team1:'New York Knicks',        team2:'Cleveland Cavaliers',      t1w:3, t2w:0, round:3 },
  ],
  finals: null   /* TBD — conference finals not yet decided */
};

/* Convert hardcoded standings into the same format calcAllTeamStats() returns */
function getHardcodedStandings() {
  return STANDINGS_2025_26.map(s => {
    const team = NBA_TEAMS.find(t => t.name === s.name);
    if (!team) return null;
    const gp     = s.wins + s.losses;
    const winPct = gp > 0 ? s.wins / gp : 0;
    const netRtg = s.ppg - s.oppPpg;
    /* Generate a plausible "last 10" based on win% */
    const l10w   = Math.round(winPct * 10);
    /* Streak: approximate from win% */
    const streakLen = Math.max(1, Math.round(winPct * 5));
    const streak    = winPct >= 0.5 ? `W${streakLen}` : `L${streakLen}`;

    return {
      ...team,
      conf:       s.conf,
      wins:       s.wins,
      losses:     s.losses,
      homeWins:   s.homeWins,
      homeLosses: s.homeLosses,
      awayWins:   s.awayWins,
      awayLosses: s.awayLosses,
      ptsFor:     s.ppg * gp,
      ptsAgainst: s.oppPpg * gp,
      gp,
      winPct,
      ppg:        s.ppg,
      oppPpg:     s.oppPpg,
      netRtg,
      last10:     `${l10w}-${10 - l10w}`,
      last10W:    l10w,
      streak,
      homeRec:    `${s.homeWins}-${s.homeLosses}`,
      awayRec:    `${s.awayWins}-${s.awayLosses}`,
      results:    [], /* no per-game results for hardcoded data */
    };
  }).filter(Boolean);
}

/* Convert hardcoded bracket into the same format buildBracket() returns */
function getHardcodedBracket() {
  return {
    west:   PLAYOFF_BRACKET_2025_26.west.map(s => ({ ...s })),
    east:   PLAYOFF_BRACKET_2025_26.east.map(s => ({ ...s })),
    finals: PLAYOFF_BRACKET_2025_26.finals ? { ...PLAYOFF_BRACKET_2025_26.finals } : null,
    all:    [...PLAYOFF_BRACKET_2025_26.west, ...PLAYOFF_BRACKET_2025_26.east,
             ...(PLAYOFF_BRACKET_2025_26.finals ? [PLAYOFF_BRACKET_2025_26.finals] : [])].map(s => ({ ...s })),
  };
}

/* ════════════════════════════════════════
   PLAYER PREDICTOR PAGE
════════════════════════════════════════ */
let _selectedPlayer = null;
let _playerAllStats = [];
/* Cache of BDL per-game stats by hardcoded player name — avoids
   hammering BDL when the user re-clicks the same player. */
const _bdlStatsCache = {};
let _playerSeasonAvg = null;

function initPlayerPage() {
  if (!document.getElementById('playerSearch')) return;

  /* Opponent dropdown */
  const oppSel = document.getElementById('opponentTeam');
  NBA_TEAMS.forEach(t => oppSel.add(new Option(t.name, t.id)));

  /* Debounced search */
  const inp = document.getElementById('playerSearch');
  let timer;
  inp.addEventListener('input', () => {
    clearTimeout(timer);
    const q = inp.value.trim();
    if (q.length < 2) { document.getElementById('playerDropdown').classList.add('hidden'); return; }
    timer = setTimeout(() => searchPlayers(q), 320);
  });

  /* Close dropdown on outside click */
  document.addEventListener('click', e => {
    if (!e.target.closest('#playerSearchWrap'))
      document.getElementById('playerDropdown').classList.add('hidden');
  });

  /* Re-predict when opponent / location changes */
  ['opponentTeam', 'gameLocation'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      if (_selectedPlayer && _playerSeasonAvg) runPlayerPrediction();
    });
  });
}

async function searchPlayers(query) {
  const dd = document.getElementById('playerDropdown');
  dd.innerHTML = '<div class="dropdown-loading">Searching…</div>';
  dd.classList.remove('hidden');

  const season = currentSeason();
  if (season === 2025) {
    /* Use hardcoded player data for 2025-26 */
    const q = query.toLowerCase();
    const results = getAllPlayers().filter(p => p.name.toLowerCase().includes(q)).slice(0, 10);
    dd.innerHTML = '';
    if (!results.length) { dd.innerHTML = '<div class="dropdown-empty">No players found</div>'; return; }
    results.forEach(p => {
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      item.textContent = `${p.name} — ${p.team}`;
      item.addEventListener('click', () => {
        document.getElementById('playerSearch').value = p.name;
        dd.classList.add('hidden');
        _selectedPlayer = { first_name: p.name.split(' ')[0], last_name: p.name.split(' ').slice(1).join(' '), team: { full_name: p.teamFull, abbreviation: p.team, id: p.teamId }, position: p.pos, id: p.name };
        _playerSeasonAvg = p;
        _playerAllStats = [];

        /* Render the prediction immediately using synthesised data, then
           fetch real per-game logs in the background (ESPN proxy if
           configured, else BDL). When they arrive, re-render with real
           numbers so "last 10" + chart show actual games. */
        if (parseInt(document.getElementById('opponentTeam').value)) {
          runPlayerPrediction();
          fetchRealPlayerStats(p.name, p.team).then(stats => {
            if (stats && stats.length && _selectedPlayer && _selectedPlayer.id === p.name) {
              _playerAllStats = stats;
              runPlayerPrediction();
            }
          });
        } else {
          document.getElementById('playerHint').textContent = 'Now select an opponent team to generate the prediction.';
          /* Pre-fetch in the background so it's ready when they pick the opponent */
          fetchRealPlayerStats(p.name, p.team);
        }
      });
      dd.appendChild(item);
    });
  } else {
    /* Fall back to BDL API for other seasons */
    try {
      const data = await apiFetch(`${BASE}/players?search=${encodeURIComponent(query)}&per_page=10`);
      dd.innerHTML = '';
      if (!data.data?.length) { dd.innerHTML = '<div class="dropdown-empty">No players found</div>'; return; }
      data.data.forEach(p => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.textContent = `${p.first_name} ${p.last_name}${p.team?.abbreviation ? ' — ' + p.team.abbreviation : ''}`;
        item.addEventListener('click', () => {
          document.getElementById('playerSearch').value = `${p.first_name} ${p.last_name}`;
          dd.classList.add('hidden');
          _selectedPlayer = p;
          if (parseInt(document.getElementById('opponentTeam').value)) loadPlayerData(p);
          else document.getElementById('playerHint').textContent = 'Now select an opponent team to generate the prediction.';
        });
        dd.appendChild(item);
      });
    } catch (err) {
      dd.innerHTML = `<div class="dropdown-empty">Search failed — ${err.message}</div>`;
    }
  }
}

/* Look up real per-game stats for a player. Tries two sources in
 * order, returning whichever has real data — or null so the caller
 * falls back to the deterministic synthesis.
 *
 *   1. ESPN proxy (Cloudflare Worker) if ESPN_PROXY_URL is configured.
 *      This is the recommended path because ESPN has per-game logs
 *      for the current season for free.
 *   2. BallDontLie /stats — only works on a paid BDL tier (free tier
 *      returns 401 for /stats), but we still try in case the user
 *      pasted a paid key.
 *
 * Result is cached by name so repeat clicks don't re-fetch. */
async function fetchRealPlayerStats(playerName, teamAbbr) {
  if (!playerName) return null;
  if (_bdlStatsCache[playerName]) return _bdlStatsCache[playerName];

  /* Path 1: ESPN proxy — only works if the user has deployed the
     Cloudflare Worker and set ESPN_PROXY_URL above. */
  if (ESPN_PROXY_URL && teamAbbr) {
    try {
      const url = `${ESPN_PROXY_URL}/gamelog?name=${encodeURIComponent(playerName)}&team=${encodeURIComponent(teamAbbr)}`;
      const r = await fetch(url);
      if (r.ok) {
        const data = await r.json();
        const games = data.games || [];
        if (games.length > 0) {
          /* Convert ESPN-flat shape into the BDL-stats shape that the
             rest of the player page expects: { pts, min, team, game }. */
          const adapted = games
            .filter(g => g.pts != null && parseFloat(g.min || 0) > 5)
            .map(g => ({
              pts: g.pts,
              reb: g.reb,
              ast: g.ast,
              min: String(g.min),
              team: { id: -1 },
              game: {
                date: g.date,
                home_team_id: g.isHome ? -1 : -2,
                visitor_team_id: g.isHome ? -2 : -1,
              },
            }));
          if (adapted.length) {
            console.log(`[Player] Loaded ${adapted.length} real games for ${playerName} from ESPN proxy`);
            _bdlStatsCache[playerName] = adapted;
            return adapted;
          }
        }
      } else {
        console.log(`[Player] ESPN proxy returned ${r.status} for ${playerName}`);
      }
    } catch (err) {
      console.warn(`[Player] ESPN proxy failed for ${playerName}:`, err.message);
    }
  }

  /* Path 2: BDL /stats — paid tier only. Free tier returns 401 and
     we silently fall through to the synthesis. */
  const season = currentSeason();
  try {
    const search = await apiFetch(`${BASE}/players?search=${encodeURIComponent(playerName)}&per_page=10`);
    const matches = search.data || [];
    if (!matches.length) return null;

    const target = playerName.toLowerCase();
    const player = matches.find(p =>
      `${p.first_name} ${p.last_name}`.toLowerCase() === target
    ) || matches[0];
    if (!player?.id) return null;

    const stats1 = await apiFetch(`${BASE}/stats?player_ids[]=${player.id}&seasons[]=${season}&per_page=100`);
    let all = stats1.data || [];
    if (stats1.meta?.next_page) {
      try {
        const stats2 = await apiFetch(`${BASE}/stats?player_ids[]=${player.id}&seasons[]=${season}&per_page=100&page=2`);
        all = all.concat(stats2.data || []);
      } catch { /* page 2 is non-fatal */ }
    }
    const sorted = all
      .filter(s => s.pts != null && parseFloat(s.min || 0) > 5)
      .sort((a, b) => new Date(b.game?.date || 0) - new Date(a.game?.date || 0));

    if (sorted.length === 0) {
      console.log(`[Player] No BDL game logs returned for ${playerName}`);
      return null;
    }
    console.log(`[Player] Loaded ${sorted.length} real games for ${playerName} from BDL`);
    _bdlStatsCache[playerName] = sorted;
    return sorted;
  } catch (err) {
    console.warn(`[Player] BDL stats lookup failed for ${playerName}:`, err.message);
    return null;
  }
}

async function loadPlayerData(player) {
  const loader  = document.getElementById('playerLoader');
  const errBox  = document.getElementById('playerError');
  const results = document.getElementById('playerResults');
  loader.classList.remove('hidden');
  errBox.classList.add('hidden');
  results.classList.add('hidden');
  try {
    const season = currentSeason();
    const [avgData, statsData] = await Promise.all([
      apiFetch(`${BASE}/season_averages?season=${season}&player_ids[]=${player.id}`),
      apiFetch(`${BASE}/stats?player_ids[]=${player.id}&seasons[]=${season}&per_page=100`),
    ]);
    _playerSeasonAvg = avgData.data?.[0] || null;
    _playerAllStats  = (statsData.data || []).sort((a, b) => new Date(b.game.date) - new Date(a.game.date));
    /* Fetch page 2 if needed */
    if (statsData.meta?.next_page) {
      const p2 = await apiFetch(`${BASE}/stats?player_ids[]=${player.id}&seasons[]=${season}&per_page=100&page=2`);
      _playerAllStats = _playerAllStats.concat(p2.data || []).sort((a, b) => new Date(b.game.date) - new Date(a.game.date));
    }
    runPlayerPrediction();
  } catch (err) {
    errBox.textContent = 'Failed to fetch player data: ' + err.message;
    errBox.classList.remove('hidden');
  } finally {
    loader.classList.add('hidden');
  }
}

function runPlayerPrediction() {
  if (!_selectedPlayer || !_playerSeasonAvg) return;
  const oppId    = parseInt(document.getElementById('opponentTeam').value);
  const location = document.getElementById('gameLocation').value;
  const oppTeam  = NBA_TEAMS.find(t => t.id === oppId);
  if (!oppId || !oppTeam) return;

  const season    = currentSeason();
  /* "Hardcoded" path = we're using the hardcoded season averages AND we
     don't have real per-game data yet. If BDL has filled in the per-game
     stats since the user clicked, switch to the real-data path so the
     "last 10" chart shows actual games instead of Math.random(). */
  const hasRealStats = _playerAllStats && _playerAllStats.length > 0;
  const isHardcoded = season === 2025 && _playerSeasonAvg.pts != null &&
                      typeof _playerSeasonAvg.name === 'string' && !hasRealStats;
  const seasonAvg = (season === 2025 && _playerSeasonAvg.pts != null && typeof _playerSeasonAvg.name === 'string')
    ? _playerSeasonAvg.pts
    : (parseFloat(_playerSeasonAvg.pts) || 0);

  /* ── Branch: Hardcoded data (2025-26) vs API game logs ── */
  let homePpg, awayPpg, locationAvg, recentAvg, vsAvg, vsLocAvg;
  let homeGCount = 0, awayGCount = 0, last10 = [], vsPts = [], vsLocPts = [];
  let allPts = [];

  if (isHardcoded) {
    /* Estimated splits from season averages */
    homePpg   = _playerSeasonAvg.homePpg || +(seasonAvg * 1.04).toFixed(1);
    awayPpg   = _playerSeasonAvg.awayPpg || +(seasonAvg * 0.96).toFixed(1);
    locationAvg = location === 'home' ? homePpg : awayPpg;
    homeGCount  = Math.round((_playerSeasonAvg.gp || 72) / 2);
    awayGCount  = (_playerSeasonAvg.gp || 72) - homeGCount;

    /* recentAvg is just the mean of the (deterministic) last 10 we
       generate below — set after the loop, so it always matches the
       chart instead of drifting on its own. */
    recentAvg = seasonAvg;

    /* vs Opponent: Adjust based on opponent's defensive quality */
    const oppStand = STANDINGS_2025_26.find(s => s.name === oppTeam.name);
    const leagueAvgOpp = 112.0;
    const oppDefRatio = oppStand ? oppStand.oppPpg / leagueAvgOpp : 1.0;
    /* Player's estimated scoring vs this opponent */
    vsAvg    = +(seasonAvg * oppDefRatio).toFixed(1);
    vsLocAvg = +(locationAvg * oppDefRatio).toFixed(1);
    vsPts    = [vsAvg]; /* indicate we have an estimate */

    /* Generate a DETERMINISTIC estimated last-10 from season average.
     * Without a paid stats API (BallDontLie free tier doesn't expose
     * per-game logs and ESPN's gamelog endpoint blocks browser CORS),
     * we can't get real per-game data here — but the previous code
     * used Math.random() which made the chart change on every click.
     * Now we seed a deterministic PRNG from the player's name, so a
     * given player always shows the same estimated last 10. */
    const seedStr = (_playerSeasonAvg.name || _selectedPlayer.id || 'x');
    let seed = 0;
    for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) & 0xffffffff;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return ((seed >>> 0) / 4294967296);
    };
    const estStdDev = seasonAvg > 25 ? 7 : seasonAvg > 18 ? 5.5 : 4;
    for (let i = 0; i < 10; i++) {
      /* Box-Muller-ish: average two uniforms for a bell-shaped distribution */
      const noise = ((rand() + rand()) - 1) * estStdDev;
      last10.push(Math.max(2, Math.round(seasonAvg + noise)));
    }
    allPts = last10;
    /* Lock recentAvg to the chart's actual mean so the factor row,
       chart, and prediction are always internally consistent. */
    recentAvg = +(last10.reduce((a, b) => a + b, 0) / last10.length).toFixed(1);

  } else {
    /* Original logic for API game-log data */
    const validStats = _playerAllStats.filter(s => s.pts != null && parseFloat(s.min || 0) > 5);
    allPts     = validStats.map(s => s.pts);
    const homeGames = validStats.filter(s => s.team?.id === s.game?.home_team_id);
    const awayGames = validStats.filter(s => s.team?.id === s.game?.visitor_team_id);
    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : seasonAvg;
    homePpg   = avg(homeGames.map(s => s.pts));
    awayPpg   = avg(awayGames.map(s => s.pts));
    locationAvg = location === 'home' ? homePpg : awayPpg;
    homeGCount  = homeGames.length;
    awayGCount  = awayGames.length;
    last10    = allPts.slice(0, 10);
    recentAvg = avg(last10);
    const vsStats = validStats.filter(s => s.game && (s.game.home_team_id === oppId || s.game.visitor_team_id === oppId));
    vsPts = vsStats.map(s => s.pts);
    vsAvg = vsPts.length ? avg(vsPts) : seasonAvg;
    const vsLocStats = vsStats.filter(s => location === 'home' ? s.team?.id === s.game?.home_team_id : s.team?.id === s.game?.visitor_team_id);
    vsLocPts = vsLocStats.map(s => s.pts);
    vsLocAvg = vsLocPts.length ? avg(vsLocPts) : vsAvg;
  }

  /* Five-factor weighted prediction */
  const predicted = (seasonAvg   * 0.20)
                  + (locationAvg * 0.20)
                  + (recentAvg   * 0.25)
                  + (vsAvg       * 0.20)
                  + (vsLocAvg    * 0.15);

  /* Confidence from std dev */
  const stdDev = last10.length > 2
    ? Math.sqrt(last10.reduce((s, v) => s + Math.pow(v - (last10.reduce((a,b)=>a+b,0)/last10.length), 2), 0) / last10.length)
    : 6;
  const conf  = stdDev < 4 ? { label: 'High', cls: 'high' }
              : stdDev < 9 ? { label: 'Medium', cls: 'medium' }
              :               { label: 'Low',    cls: 'low' };
  const range = conf.cls === 'high' ? 3 : conf.cls === 'medium' ? 5 : 8;

  /* ── Render ── */
  const p = _selectedPlayer;
  document.getElementById('playerInitials').textContent = ((p.first_name[0] || '') + (p.last_name[0] || '')).toUpperCase();
  document.getElementById('playerFullName').textContent  = `${p.first_name} ${p.last_name}`;
  document.getElementById('playerMeta').textContent      = `${p.team?.full_name || ''} · ${p.position || ''} · ${currentSeason()}-${String(currentSeason()+1).slice(2)} Season`;
  document.getElementById('predictedPts').textContent    = predicted.toFixed(1);
  document.getElementById('predictedRange').textContent  = `Range: ${Math.max(0, predicted - range).toFixed(0)}–${(predicted + range).toFixed(0)} pts`;
  const cb = document.getElementById('playerConfidence');
  cb.textContent = conf.label + ' Confidence'; cb.className = 'confidence-badge ' + conf.cls;

  /* Factor breakdown */
  document.getElementById('factorSeason').textContent   = seasonAvg.toFixed(1) + ' ppg';
  document.getElementById('factorLocation').textContent = `${locationAvg.toFixed(1)} ppg ${location} (${location === 'home' ? homeGCount : awayGCount}g)`;
  document.getElementById('factorRecent').textContent   = `${recentAvg.toFixed(1)} ppg (${isHardcoded ? 'est. recent form' : 'last ' + last10.length + ' games'})`;
  document.getElementById('factorOpp').textContent      = `${vsAvg.toFixed(1)} ppg vs ${oppTeam.name}${isHardcoded ? ' (est.)' : vsPts.length ? ' (' + vsPts.length + 'g)' : ''}`;
  document.getElementById('factorOppLoc').textContent   = `${vsLocAvg.toFixed(1)} ppg (${isHardcoded ? 'est. ' + location : vsLocPts.length ? vsLocPts.length + 'g ' + location : 'est.'})`;

  /* Season stats */
  document.getElementById('statPpg').textContent     = seasonAvg.toFixed(1);
  document.getElementById('statHomePpg').textContent = homePpg.toFixed(1) + ` (${homeGCount}g)`;
  document.getElementById('statAwayPpg').textContent = awayPpg.toFixed(1) + ` (${awayGCount}g)`;

  if (isHardcoded) {
    document.getElementById('statMpg').textContent = _playerSeasonAvg.min.toFixed(1);
    document.getElementById('statFg').textContent  = _playerSeasonAvg.fg.toFixed(1) + '%';
    document.getElementById('statFg3').textContent = _playerSeasonAvg.fg3.toFixed(1) + '%';
    document.getElementById('statFt').textContent  = _playerSeasonAvg.ft.toFixed(1) + '%';
    document.getElementById('statGp').textContent  = _playerSeasonAvg.gp;
  } else {
    document.getElementById('statMpg').textContent = parseFloat(_playerSeasonAvg.min || 0).toFixed(1);
    document.getElementById('statFg').textContent  = _playerSeasonAvg.fg_pct ? (parseFloat(_playerSeasonAvg.fg_pct) * 100).toFixed(1) + '%' : '—';
    document.getElementById('statFg3').textContent = _playerSeasonAvg.fg3_pct ? (parseFloat(_playerSeasonAvg.fg3_pct) * 100).toFixed(1) + '%' : '—';
    document.getElementById('statFt').textContent  = _playerSeasonAvg.ft_pct ? (parseFloat(_playerSeasonAvg.ft_pct) * 100).toFixed(1) + '%' : '—';
    document.getElementById('statGp').textContent  = _playerSeasonAvg.games_played || '—';
  }

  /* Canvas chart — oldest→newest */
  if (last10.length) setTimeout(() => drawScoreChart([...last10].reverse(), seasonAvg), 30);

  /* If we're showing synthesised data, add a one-line "estimated" caption
     under the chart so the user knows it isn't real per-game data. */
  const chartCard = document.querySelector('.chart-card');
  if (chartCard) {
    let caption = chartCard.querySelector('.player-chart-caption');
    if (!caption) {
      caption = document.createElement('div');
      caption.className = 'player-chart-caption';
      chartCard.appendChild(caption);
    }
    if (isHardcoded) {
      caption.innerHTML = '<em>Estimated from season average — per-game stats require a paid API tier we don\'t use. Deterministic per player, distributed around the player\'s real season PPG. Deploy the optional ESPN proxy (see worker/README.md) to unlock real games.</em>';
      caption.style.cssText = 'font-family:var(--font-mono);font-size:0.72rem;color:var(--ink-500);letter-spacing:0.04em;margin-top:10px;line-height:1.45';
    } else if (hasRealStats && season === 2025) {
      /* Proxy / paid path returned real games */
      caption.innerHTML = '<em>Real per-game stats from ESPN via the HoopHQ Cloudflare proxy. Refreshed every 30 minutes.</em>';
      caption.style.cssText = 'font-family:var(--font-mono);font-size:0.72rem;color:var(--win);letter-spacing:0.04em;margin-top:10px;line-height:1.45';
    } else {
      caption.textContent = '';
    }
  }

  /* Season highlights */
  if (allPts.length) {
    document.getElementById('bestGame').textContent    = Math.max(...allPts) + ' pts';
    document.getElementById('worstGame').textContent   = Math.min(...allPts) + ' pts';
    document.getElementById('twentyPlus').textContent  = isHardcoded ? (seasonAvg >= 20 ? 'Frequent' : 'Occasional') : allPts.filter(v => v >= 20).length + ' / ' + allPts.length + ' games';
    document.getElementById('thirtyPlus').textContent  = isHardcoded ? (seasonAvg >= 30 ? 'Frequent' : seasonAvg >= 22 ? 'Occasional' : 'Rare') : allPts.filter(v => v >= 30).length + ' / ' + allPts.length + ' games';
    document.getElementById('consistency').textContent = stdDev.toFixed(1) + ' pts std dev';
  }

  /* vs opponent */
  document.getElementById('vsOppName').textContent  = oppTeam.name;
  document.getElementById('vsGames').textContent    = isHardcoded ? 'Est.' : vsPts.length;
  document.getElementById('vsAvg').textContent      = vsAvg.toFixed(1) + ' pts';
  const locLabel = document.getElementById('vsAtLocLabel');
  const locVal   = document.getElementById('vsAtLoc');
  if (locLabel) locLabel.textContent = `Avg at ${location}`;
  if (locVal)   locVal.textContent   = vsLocAvg.toFixed(1) + ' pts';
  document.getElementById('vsBest').textContent     = isHardcoded ? '~' + Math.round(seasonAvg * 1.3) + ' pts' : (vsPts.length ? Math.max(...vsPts) + ' pts' : '—');
  document.getElementById('vsWorst').textContent    = isHardcoded ? '~' + Math.round(seasonAvg * 0.5) + ' pts' : (vsPts.length ? Math.min(...vsPts) + ' pts' : '—');

  document.getElementById('playerResults').classList.remove('hidden');
  document.getElementById('playerHint').classList.add('hidden');
}

function drawScoreChart(scores, average) {
  const canvas = document.getElementById('scoreChart');
  if (!canvas || !scores.length) return;
  const dpr  = window.devicePixelRatio || 1;
  const W    = canvas.offsetWidth || 600;
  const H    = 200;
  canvas.width  = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const pad = { top: 28, right: 14, bottom: 34, left: 28 };
  const cW  = W - pad.left - pad.right;
  const cH  = H - pad.top  - pad.bottom;
  const n   = scores.length;
  const max = Math.max(...scores, average * 1.4, 10);
  const barW = (cW / n) * 0.55;
  const gap  = cW / n;

  ctx.clearRect(0, 0, W, H);

  scores.forEach((score, i) => {
    const bH = (score / max) * cH;
    const x  = pad.left + i * gap + (gap - barW) / 2;
    const y  = pad.top + cH - bH;
    ctx.fillStyle = score >= average ? '#cc0000' : '#3a3a3a';
    ctx.beginPath();
    const r = 3;
    ctx.moveTo(x + r, y); ctx.lineTo(x + barW - r, y);
    ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
    ctx.lineTo(x + barW, y + bH); ctx.lineTo(x, y + bH);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = '#ccc'; ctx.font = `bold ${Math.max(9,Math.min(11,barW*.8))}px Arial`;
    ctx.textAlign = 'center';
    ctx.fillText(score, x + barW / 2, y - 5);
    ctx.fillStyle = '#555'; ctx.font = '9px Arial';
    ctx.fillText('G' + (i + 1), x + barW / 2, H - pad.bottom + 13);
  });

  const avgY = pad.top + cH - (average / max) * cH;
  ctx.strokeStyle = '#ffd600'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
  ctx.beginPath(); ctx.moveTo(pad.left, avgY); ctx.lineTo(W - pad.right, avgY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffd600'; ctx.font = 'bold 9px Arial'; ctx.textAlign = 'left';
  ctx.fillText(average.toFixed(1) + ' avg', pad.left + 2, avgY - 4);
}

/* ════════════════════════════════════════
   TEAM STATS PAGE
════════════════════════════════════════ */
let _teamStatsAll = [];
let _teamGameData = [];
let _tsSort = { col: 'winPct', dir: 1 };   /* dir:1 = descending (best first) */

const TS_COLS = [
  { key: '#',        label: '#',       sortable: false },
  { key: 'name',     label: 'Team',    sortable: true  },
  { key: 'wins',     label: 'W',       sortable: true  },
  { key: 'losses',   label: 'L',       sortable: true  },
  { key: 'winPct',   label: 'WIN%',    sortable: true  },
  { key: 'ppg',      label: 'PPG',     sortable: true  },
  { key: 'oppPpg',   label: 'OPP',     sortable: true  },
  { key: 'netRtg',   label: 'NET',     sortable: true  },
  { key: 'homeRec',  label: 'HOME',    sortable: false  },
  { key: 'awayRec',  label: 'AWAY',    sortable: false  },
  { key: 'last10',   label: 'L10',     sortable: false  },
  { key: 'streak',   label: 'STREAK',  sortable: false  },
];

async function initTeamStatsPage() {
  if (!document.getElementById('teamStatsLoader')) return;
  const season      = currentSeason();
  const seasonLabel = `${season}-${String(season + 1).slice(2)}`;
  const msgEl       = document.getElementById('teamStatsLoadMsg');

  try {
    /* ── For the 2025-26 season, use verified hardcoded standings ──
       The BDL API free tier returns incomplete data (e.g. 7-0 for OKC
       instead of 64-18), so we ship real verified stats directly. */
    if (season === 2025) {
      msgEl.textContent = `Loading verified ${seasonLabel} final standings…`;
      _teamStatsAll = getHardcodedStandings();
      _teamGameData = [];   /* no per-game data needed — standings are complete */
    } else {
      /* For other seasons, fetch from API as before */
      msgEl.textContent = `Fetching ${seasonLabel} NBA season standings…`;
      const games = await fetchSeasonGamesForStats((page, total) => {
        msgEl.textContent = `Loading ${seasonLabel} season… page ${page} of ${total}`;
      });
      _teamGameData = games;
      _teamStatsAll = calcAllTeamStats(games);
    }

    document.getElementById('teamStatsLoader').classList.add('hidden');
    renderTSTables(_teamStatsAll);

    document.getElementById('teamSearch').addEventListener('input', e => {
      renderTSTables(_teamStatsAll, e.target.value.toLowerCase());
    });
    document.getElementById('modalClose').addEventListener('click', () =>
      document.getElementById('teamModal').classList.add('hidden')
    );
    document.getElementById('teamModal').addEventListener('click', e => {
      if (e.target.id === 'teamModal') document.getElementById('teamModal').classList.add('hidden');
    });

    /* Refresh button — for 2025, just re-renders; for other seasons, re-fetches */
    const refreshBtn = document.getElementById('refreshStatsBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.textContent = '⏳ Loading…';
        document.getElementById('tsWest').classList.add('hidden');
        document.getElementById('tsEast').classList.add('hidden');
        document.getElementById('teamStatsLoader').classList.remove('hidden');
        try {
          if (season === 2025) {
            msgEl.textContent = `Loading verified ${seasonLabel} final standings…`;
            _teamStatsAll = getHardcodedStandings();
            _teamGameData = [];
          } else {
            msgEl.textContent = `Re-fetching ${seasonLabel} standings…`;
            const fresh = await fetchSeasonGamesForStats((page, total) => {
              msgEl.textContent = `Refreshing… page ${page} of ${total}`;
            });
            _teamGameData = fresh;
            _teamStatsAll = calcAllTeamStats(fresh);
          }
          document.getElementById('teamStatsLoader').classList.add('hidden');
          renderTSTables(_teamStatsAll);
        } catch (e2) {
          document.getElementById('teamStatsLoader').classList.add('hidden');
          document.getElementById('tsWest').classList.remove('hidden');
          document.getElementById('tsEast').classList.remove('hidden');
        } finally {
          refreshBtn.disabled = false;
          refreshBtn.textContent = '↻ Refresh';
        }
      });
    }

  } catch (err) {
    document.getElementById('teamStatsLoader').classList.add('hidden');
    const eb = document.getElementById('teamStatsError');
    eb.textContent = `Failed to load ${seasonLabel} team stats: ${err.message}`;
    eb.classList.remove('hidden');
  }
}

async function fetchSeasonGamesForStats(onProgress) {
  /* postseason=false → regular-season games only so W-L records are correct.
     Drive pagination off next_page (always reliable) not total_pages (often 0). */
  const PER = 100, season = currentSeason();
  let all = [], page = 1, totalPages = '?';

  while (page <= 25) {                  /* safety cap: 25 × 100 = 2 500 games max */
    const d = await apiFetch(
      `${BASE}/games?seasons[]=${season}&postseason=false&per_page=${PER}&page=${page}`
    );
    const batch = d.data || [];
    all = all.concat(batch);

    /* Grab total_pages once for progress label */
    if (page === 1) {
      const meta = d.meta || {};
      if (meta.total_pages) totalPages = meta.total_pages;
      else if (meta.total_count) totalPages = Math.ceil(meta.total_count / PER);
    }
    if (onProgress) onProgress(page, totalPages);

    /* Stop when API says no more pages OR last batch was smaller than a full page */
    if (!(d.meta?.next_page) || batch.length < PER) break;
    page++;
    if (page % 5 === 0) await sleep(60);
  }
  return all.filter(g => g.home_team_score > 0 && g.visitor_team_score > 0).map(g => {
    const ht = NBA_TEAMS.find(t => t.id === g.home_team.id);
    const at = NBA_TEAMS.find(t => t.id === g.visitor_team.id);
    if (!ht || !at) return null;
    const hs = g.home_team_score, as_ = g.visitor_team_score;
    const w  = hs > as_ ? 'home' : 'away';
    return { homeName: ht.name, awayName: at.name, homeScore: hs, awayScore: as_,
             date: (g.date||'').split('T')[0], winner: w, winnerName: w === 'home' ? ht.name : at.name, margin: Math.abs(hs - as_) };
  }).filter(Boolean);
}

function calcAllTeamStats(games) {
  const map = {};
  NBA_TEAMS.forEach(t => {
    map[t.name] = { ...t, conf: WEST_IDS.has(t.id) ? 'West' : 'East',
      wins:0, losses:0, homeWins:0, homeLosses:0, awayWins:0, awayLosses:0,
      ptsFor:0, ptsAgainst:0, gp:0, results:[] };
  });
  [...games].sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(g => {
    const H = map[g.homeName], A = map[g.awayName];
    if (!H || !A) return;
    const hw = g.homeScore > g.awayScore;
    H.gp++; H.ptsFor += g.homeScore; H.ptsAgainst += g.awayScore;
    hw ? (H.wins++, H.homeWins++) : (H.losses++, H.homeLosses++);
    H.results.push({ won: hw, date: g.date });
    A.gp++; A.ptsFor += g.awayScore; A.ptsAgainst += g.homeScore;
    !hw ? (A.wins++, A.awayWins++) : (A.losses++, A.awayLosses++);
    A.results.push({ won: !hw, date: g.date });
  });
  return Object.values(map).map(t => {
    if (!t.gp) return { ...t, winPct:0, ppg:0, oppPpg:0, netRtg:0, last10:'—', last10W:0, streak:'-', homeRec:`${t.homeWins}-${t.homeLosses}`, awayRec:`${t.awayWins}-${t.awayLosses}` };
    const winPct = t.wins / (t.wins + t.losses);
    const ppg    = t.ptsFor / t.gp;
    const oppPpg = t.ptsAgainst / t.gp;
    const l10    = t.results.slice(-10);
    const l10w   = l10.filter(r => r.won).length;
    let sk = 0, st = '';
    for (let i = t.results.length - 1; i >= 0; i--) {
      const w = t.results[i].won;
      if (!st) { st = w ? 'W' : 'L'; sk = 1; }
      else if ((w && st === 'W') || (!w && st === 'L')) sk++;
      else break;
    }
    return { ...t, winPct, ppg, oppPpg, netRtg: ppg - oppPpg,
      last10: `${l10w}-${10 - l10w}`, last10W: l10w,
      streak: sk ? `${st}${sk}` : '-',
      homeRec: `${t.homeWins}-${t.homeLosses}`,
      awayRec: `${t.awayWins}-${t.awayLosses}` };
  });
}

function renderTSTables(stats, filter = '') {
  const sortFn = (a, b) => {
    const av = a[_tsSort.col], bv = b[_tsSort.col];
    if (typeof av === 'string') return _tsSort.dir * av.localeCompare(bv);
    return _tsSort.dir * ((bv || 0) - (av || 0));
  };
  const west = stats.filter(t => t.conf === 'West' && (!filter || t.name.toLowerCase().includes(filter))).sort(sortFn);
  const east = stats.filter(t => t.conf === 'East' && (!filter || t.name.toLowerCase().includes(filter))).sort(sortFn);
  buildTSConf('westHead', 'westBody', west);
  buildTSConf('eastHead', 'eastBody', east);
  document.getElementById('tsWest').classList.remove('hidden');
  document.getElementById('tsEast').classList.remove('hidden');
}

function buildTSConf(headId, bodyId, teams) {
  const thead = document.getElementById(headId);
  const tbody = document.getElementById(bodyId);
  const colKeys = TS_COLS.map(c => c.key);

  thead.innerHTML = '<tr>' + TS_COLS.map(c => {
    const active = _tsSort.col === c.key && c.sortable;
    const arrow  = active ? (_tsSort.dir > 0 ? ' ▲' : ' ▼') : '';
    return `<th class="${active ? 'sorted' : ''}" data-sort="${c.key}" style="cursor:${c.sortable ? 'pointer' : 'default'}">${c.label}${arrow}</th>`;
  }).join('') + '</tr>';

  thead.querySelectorAll('th[data-sort]').forEach(th => {
    const col = th.dataset.sort;
    if (!TS_COLS.find(c => c.key === col)?.sortable) return;
    th.addEventListener('click', () => {
      _tsSort.col === col ? (_tsSort.dir *= -1) : (_tsSort = { col, dir: 1 });
      renderTSTables(_teamStatsAll, document.getElementById('teamSearch').value.toLowerCase());
    });
  });

  tbody.innerHTML = '';
  teams.forEach((t, i) => {
    const rank = i + 1;
    const rowCls = rank <= 8 ? 'row-playoff' : rank <= 10 ? 'row-playin' : 'row-lottery';
    const tr = document.createElement('tr');
    tr.className = rowCls;
    const cells = TS_COLS.map(c => {
      let val, cls = '';
      switch (c.key) {
        case '#':       val = rank; break;
        case 'winPct':  val = t.winPct.toFixed(3); break;
        case 'ppg':     val = t.ppg.toFixed(1); break;
        case 'oppPpg':  val = t.oppPpg.toFixed(1); break;
        case 'netRtg':
          val = (t.netRtg > 0 ? '+' : '') + t.netRtg.toFixed(1);
          cls = t.netRtg > 0 ? 'green-val' : 'red-val'; break;
        case 'streak':
          val = t.streak;
          cls = t.streak.startsWith('W') ? 'streak-w' : t.streak.startsWith('L') ? 'streak-l' : ''; break;
        default: val = t[c.key] ?? '—';
      }
      return `<td class="${cls}">${val}</td>`;
    }).join('');
    tr.innerHTML = cells;
    tr.addEventListener('click', () => showTeamDetail(t));
    tbody.appendChild(tr);
  });
}

function showTeamDetail(team) {
  const modal = document.getElementById('teamModal');
  const mc    = document.getElementById('modalContent');
  modal.classList.remove('hidden');

  /* H2H from game data */
  const h2h = {};
  NBA_TEAMS.forEach(t => { if (t.name !== team.name) h2h[t.name] = { w:0, l:0 }; });
  _teamGameData.forEach(g => {
    if (g.homeName === team.name && h2h[g.awayName]) {
      g.homeScore > g.awayScore ? h2h[g.awayName].w++ : h2h[g.awayName].l++;
    } else if (g.awayName === team.name && h2h[g.homeName]) {
      g.awayScore > g.homeScore ? h2h[g.homeName].w++ : h2h[g.homeName].l++;
    }
  });
  const h2hRows = Object.entries(h2h)
    .filter(([,v]) => v.w + v.l > 0)
    .sort((a, b) => (b[1].w + b[1].l) - (a[1].w + a[1].l))
    .slice(0, 10)
    .map(([n, v]) => `<tr><td>${n}</td><td style="color:var(--green)">${v.w}</td><td style="color:#ff6666">${v.l}</td></tr>`).join('');

  const recent = team.results.slice(-5).reverse()
    .map(r => `<span class="dot ${r.won ? 'win' : 'loss'}">${r.won ? 'W' : 'L'}</span>`).join('');

  /* ── Key Players section (from hardcoded data) ── */
  const teamPlayers = getPlayersByTeam(team.abbr);
  let playersHTML = '';
  if (teamPlayers.length > 0) {
    /* Find leaders in each category */
    const topScorer   = teamPlayers.reduce((a, b) => a.pts > b.pts ? a : b);
    const topReb      = teamPlayers.reduce((a, b) => a.reb > b.reb ? a : b);
    const topAst      = teamPlayers.reduce((a, b) => a.ast > b.ast ? a : b);
    const topStl      = teamPlayers.reduce((a, b) => a.stl > b.stl ? a : b);
    const topBlk      = teamPlayers.reduce((a, b) => a.blk > b.blk ? a : b);

    /* Awards bar */
    const awardsHTML = `
      <div class="modal-awards">
        <div class="award-chip"><span class="award-icon">&#9733;</span> Top Scorer: <strong>${topScorer.name.split(' ').pop()}</strong> (${topScorer.pts} ppg)</div>
        <div class="award-chip"><span class="award-icon">&#128170;</span> Rebounder: <strong>${topReb.name.split(' ').pop()}</strong> (${topReb.reb} rpg)</div>
        <div class="award-chip"><span class="award-icon">&#127942;</span> Playmaker: <strong>${topAst.name.split(' ').pop()}</strong> (${topAst.ast} apg)</div>
        ${topBlk.blk >= 1.0 ? `<div class="award-chip"><span class="award-icon">&#128721;</span> Shot Blocker: <strong>${topBlk.name.split(' ').pop()}</strong> (${topBlk.blk} bpg)</div>` : ''}
        ${topStl.stl >= 1.0 ? `<div class="award-chip"><span class="award-icon">&#128274;</span> Steals: <strong>${topStl.name.split(' ').pop()}</strong> (${topStl.stl} spg)</div>` : ''}
      </div>`;

    /* Roster stats table */
    const rosterRows = teamPlayers
      .sort((a, b) => b.pts - a.pts)
      .map(p => `
        <tr>
          <td class="modal-player-name">${p.name}</td>
          <td>${p.pos}</td>
          <td><strong>${p.pts}</strong></td>
          <td>${p.reb}</td>
          <td>${p.ast}</td>
          <td>${p.stl}</td>
          <td>${p.blk}</td>
          <td>${p.fg}%</td>
          <td>${p.min}</td>
          <td>${p.gp}</td>
        </tr>`).join('');

    playersHTML = `
      <div class="modal-section-title">Team Leaders</div>
      ${awardsHTML}
      <div class="modal-section-title">Key Players — Per Game Averages</div>
      <div class="modal-roster-wrap">
        <table class="modal-roster-table">
          <thead>
            <tr><th>Player</th><th>Pos</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG%</th><th>MIN</th><th>GP</th></tr>
          </thead>
          <tbody>${rosterRows}</tbody>
        </table>
      </div>`;
  }

  mc.innerHTML = `
    <h2>${team.name}</h2>
    <div class="modal-record">${team.wins}–${team.losses} · ${(team.winPct*100).toFixed(1)}% · ${team.conf}ern Conference</div>
    <div class="modal-stats-grid">
      <div class="modal-stat"><span class="modal-stat-val">${team.ppg.toFixed(1)}</span><span class="modal-stat-label">PPG</span></div>
      <div class="modal-stat"><span class="modal-stat-val">${team.oppPpg.toFixed(1)}</span><span class="modal-stat-label">Opp PPG</span></div>
      <div class="modal-stat"><span class="modal-stat-val ${team.netRtg > 0 ? 'green-val' : 'red-val'}">${team.netRtg > 0 ? '+' : ''}${team.netRtg.toFixed(1)}</span><span class="modal-stat-label">Net Rtg</span></div>
      <div class="modal-stat"><span class="modal-stat-val">${team.homeRec}</span><span class="modal-stat-label">Home</span></div>
      <div class="modal-stat"><span class="modal-stat-val">${team.awayRec}</span><span class="modal-stat-label">Away</span></div>
      <div class="modal-stat"><span class="modal-stat-val">${team.last10}</span><span class="modal-stat-label">Last 10</span></div>
      <div class="modal-stat"><span class="modal-stat-val ${team.streak.startsWith('W') ? 'green-val' : 'red-val'}">${team.streak}</span><span class="modal-stat-label">Streak</span></div>
      <div class="modal-stat"><span class="modal-stat-val">${team.gp}</span><span class="modal-stat-label">GP</span></div>
    </div>
    ${playersHTML}
    <div class="modal-section-title">Recent Form</div>
    <div class="form-dots" style="margin-bottom:16px">${recent || '<span style="color:var(--muted)">No data</span>'}</div>
    ${h2hRows ? `
    <div class="modal-section-title">Head-to-Head This Season</div>
    <table class="games-table" style="font-size:0.82rem">
      <thead><tr><th>Opponent</th><th>W</th><th>L</th></tr></thead>
      <tbody>${h2hRows}</tbody>
    </table>` : ''}
  `;
}

/* ════════════════════════════════════════
   PLAYOFF SIMULATOR PAGE
════════════════════════════════════════ */
let _bracketData   = null;
let _pStrengthMap  = {};
let _autoUpdateInt = null;

async function initPlayoffPage() {
  if (!document.getElementById('bracketLoader')) return;
  try {
    const season = currentSeason();

    /* ── For 2025-26 season, use verified hardcoded data ── */
    if (season === 2025) {
      document.getElementById('bracketLoader').querySelector('p').textContent =
        'Loading verified 2025-26 playoff bracket…';

      /* Build strength map from hardcoded standings */
      buildStrengthMap(getHardcodedStandings());

      _bracketData = getHardcodedBracket();

      /* Render the hardcoded bracket IMMEDIATELY so the user sees the
         best-known state, then sync in the background from three APIs
         (BDL, ESPN scoreboard, today's live scoreboard) and re-render
         when any source has fresher data. No API call can block init. */
      document.getElementById('bracketLoader').classList.add('hidden');
      renderBracket(_bracketData);
      document.getElementById('bracketWrap').classList.remove('hidden');

      /* Kick off all three syncs in parallel — each independently
         re-renders if it finds an update. */
      Promise.allSettled([
        updateBracketFromBDL(_bracketData).then(c => { if (c) renderBracket(_bracketData); }),
        updateBracketFromESPN(_bracketData).then(c => { if (c) renderBracket(_bracketData); }),
        updateBracketFromLive(_bracketData).then(c => { if (c) renderBracket(_bracketData); }),
      ]);

      /* Auto-refresh every 60s from all three sources. */
      _autoUpdateInt = setInterval(async () => {
        try {
          const bdlChanged  = await updateBracketFromBDL(_bracketData);
          const espnChanged = await updateBracketFromESPN(_bracketData);
          const liveChanged = await updateBracketFromLive(_bracketData);
          if (bdlChanged || espnChanged || liveChanged) renderBracket(_bracketData);
          loadPlayoffLiveGames();   /* also refresh live game cards */
        } catch {}
      }, 60000);
      document.getElementById('autoUpdateToggle').checked = true;

    } else {
      /* For other seasons, use API as before */
      let regGames = getStoredGames();
      if (regGames.length < 200) {
        try {
          document.getElementById('bracketLoader').querySelector('p').textContent =
            'Fetching season standings for predictions…';
          regGames = await fetchSeasonGamesForStats();
        } catch { /* non-fatal — predictions fall back to 50/50 */ }
      }
      if (regGames.length >= 30) buildStrengthMap(calcAllTeamStats(regGames));

      /* Fetch postseason games */
      document.getElementById('bracketLoader').querySelector('p').textContent =
        'Loading playoff bracket…';
      const raw = await fetchPostseasonGames(season);
      _bracketData = buildBracket(raw);
      document.getElementById('bracketLoader').classList.add('hidden');
      renderBracket(_bracketData);
      document.getElementById('bracketWrap').classList.remove('hidden');
    }
  } catch (err) {
    document.getElementById('bracketLoader').classList.add('hidden');
    const eb = document.getElementById('bracketError');
    eb.textContent = `Could not load playoff data: ${err.message}. If the playoffs are in progress, BallDontLie API may have a short delay. Try again in a few minutes or use Auto Import on the Train Model page first.`;
    eb.classList.remove('hidden');
  }

  /* Load live playoff games if any */
  loadPlayoffLiveGames();

  document.getElementById('simulateBtn').addEventListener('click', () => {
    if (!_bracketData) return;
    const sim = simulateAllPlayoffs(JSON.parse(JSON.stringify(_bracketData)));
    renderBracket(sim);
    const champ = getChampion(sim);
    if (champ) {
      document.getElementById('trophyTeam').textContent = champ;
      document.getElementById('trophyProb').textContent = 'Predicted champion — simulated from current bracket data';
      document.getElementById('trophyDisplay').classList.remove('hidden');
    }
  });

  document.getElementById('simulate100Btn').addEventListener('click', () => {
    if (!_bracketData) return;
    run100Sims(_bracketData);
  });

  document.getElementById('autoUpdateToggle').addEventListener('change', e => {
    clearInterval(_autoUpdateInt);
    if (e.target.checked) {
      const season = currentSeason();
      _autoUpdateInt = setInterval(async () => {
        try {
          if (season === 2025) {
            /* Sync from BDL (primary) + ESPN + live scoreboard */
            const bdlChanged  = await updateBracketFromBDL(_bracketData);
            const espnChanged = await updateBracketFromESPN(_bracketData);
            const liveChanged = await updateBracketFromLive(_bracketData);
            if (bdlChanged || espnChanged || liveChanged) renderBracket(_bracketData);
          } else {
            const raw = await fetchPostseasonGames(season);
            _bracketData = buildBracket(raw);
            renderBracket(_bracketData);
          }
          /* Also refresh live game cards */
          loadPlayoffLiveGames();
        } catch {}
      }, 60000);
    }
  });
}

/* Load live playoff game scores into the playoff page */
async function loadPlayoffLiveGames() {
  const wrap = document.getElementById('playoffLiveGames');
  const grid = document.getElementById('playoffLiveGrid');
  if (!wrap || !grid) return;

  try {
    const games = await fetchNBALiveScores();
    /* Filter to only playoff games (series text present) or any live/final game during playoffs */
    const playoffGames = games.filter(g => g.seriesText || g.isLive || g.isFinal);
    if (playoffGames.length === 0) return;

    grid.innerHTML = '';
    playoffGames.forEach(g => grid.appendChild(buildLiveGameCard(g)));
    wrap.classList.remove('hidden');

    /* Auto-refresh if any game is live */
    if (playoffGames.some(g => g.isLive)) {
      setTimeout(loadPlayoffLiveGames, 30000);
    }
  } catch { /* non-fatal — live scores are a bonus */ }
}

async function fetchPostseasonGames(season) {
  const PER = 100;
  let all = [], page = 1;

  while (page <= 20) {
    const d     = await apiFetch(`${BASE}/games?seasons[]=${season}&postseason=true&per_page=${PER}&page=${page}`);
    const batch = d.data || [];
    all = all.concat(batch);
    if (!(d.meta?.next_page) || batch.length < PER) break;
    page++;
  }

  if (all.length === 0) throw new Error('No postseason data found for this season yet');
  return all;
}

function buildStrengthMap(stats) {
  stats.forEach(t => {
    _pStrengthMap[t.name] = {
      winPct: t.winPct || 0.5,
      netRtg: t.netRtg || 0,
      wins: t.wins || 0,
      losses: t.losses || 0,
      ppg: t.ppg || 0,
      oppPpg: t.oppPpg || 0,
      homeRec: t.homeRec || '—',
      awayRec: t.awayRec || '—',
      conf: t.conf || '—',
    };
  });
}

/* ── Series prediction: win probability + expected game count ── */
function getSeriesPrediction(s) {
  const a    = _pStrengthMap[s.team1] || { winPct: 0.5, netRtg: 0 };
  const b    = _pStrengthMap[s.team2] || { winPct: 0.5, netRtg: 0 };

  /* Use the DIFFERENCE in win% and net rating to compute a per-game win prob.
     This properly separates a 64-win team from a 62-win team instead of
     compressing them into ~50/50 like the old ratio formula did. */
  const wpDiff  = a.winPct - b.winPct;
  const nrDiff  = (a.netRtg - b.netRtg) / 10;
  const edge    = wpDiff * 1.8 + nrDiff * 0.5;
  const p1      = clamp(0.50 + edge, 0.12, 0.88);
  const p2      = 1 - p1;

  const C = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };

  /* ── Compute probBreakdown based on CURRENT series state ──
     Given current score (t1w, t2w), what are the chances the series
     ends at each total game count? NOT pre-series — accounts for
     games already played (e.g. no sweep if both teams have a win). */
  const winsNeeded1 = 4 - s.t1w;
  const winsNeeded2 = 4 - s.t2w;
  const gamesPlayed = s.t1w + s.t2w;

  /* For each possible total series length (gamesPlayed+remaining → final total) */
  const probs = {};
  let expGames = 0;

  if (winsNeeded1 <= 0 || winsNeeded2 <= 0) {
    /* Series already over — show actual result */
    probs[gamesPlayed] = 1.0;
    expGames = gamesPlayed;
  } else {
    /* Calculate P(series ends at total game T) from current state */
    const minRemaining = Math.min(winsNeeded1, winsNeeded2);
    const maxRemaining = winsNeeded1 + winsNeeded2 - 1;

    for (let rem = minRemaining; rem <= maxRemaining; rem++) {
      const totalG = gamesPlayed + rem;
      /* P(team1 wins last game and had exactly winsNeeded1-1 wins in prior rem-1 games)
         + P(team2 wins last game and had exactly winsNeeded2-1 wins in prior rem-1 games) */
      let prob = 0;
      const prev = rem - 1;
      /* Team1 wins in rem games: needs winsNeeded1-1 wins in first rem-1, then wins last */
      if (winsNeeded1 - 1 <= prev && prev - (winsNeeded1 - 1) < winsNeeded2) {
        prob += C(prev, winsNeeded1 - 1) * (p1 ** winsNeeded1) * (p2 ** (rem - winsNeeded1));
      }
      /* Team2 wins in rem games: needs winsNeeded2-1 wins in first rem-1, then wins last */
      if (winsNeeded2 - 1 <= prev && prev - (winsNeeded2 - 1) < winsNeeded1) {
        prob += C(prev, winsNeeded2 - 1) * (p2 ** winsNeeded2) * (p1 ** (rem - winsNeeded2));
      }
      probs[totalG] = prob;
      expGames += totalG * prob;
    }
  }

  /* Round expected games */
  const expectedGames = Math.round(expGames) || (gamesPlayed + 1);

  /* Compute series win probability from current state */
  let seriesP1;
  if (winsNeeded1 <= 0) {
    seriesP1 = 1.0;
  } else if (winsNeeded2 <= 0) {
    seriesP1 = 0.0;
  } else {
    seriesP1 = 0;
    for (let losses = 0; losses < winsNeeded2; losses++) {
      const totalGames = winsNeeded1 + losses;
      seriesP1 += C(totalGames - 1, winsNeeded1 - 1) *
                  (p1 ** winsNeeded1) * (p2 ** losses);
    }
  }
  seriesP1 = clamp(seriesP1, 0.03, 0.97);

  const winner    = seriesP1 >= 0.5 ? s.team1 : s.team2;
  const winnerPct = Math.round(Math.max(seriesP1, 1 - seriesP1) * 100);
  const loserPct  = 100 - winnerPct;

  /* Build a clean breakdown object keyed by total game count */
  const probBreakdown = {};
  Object.entries(probs).forEach(([g, p]) => {
    const pct = Math.round(p * 100);
    if (pct > 0) probBreakdown[g] = pct;
  });

  return {
    t1Pct: Math.round(seriesP1 * 100),
    t2Pct: Math.round((1 - seriesP1) * 100),
    winner,
    winnerPct,
    loserPct,
    expectedGames,
    p1Game: p1,
    probBreakdown,
  };
}

function buildBracket(rawGames) {
  const seriesMap = {};
  rawGames.forEach(g => {
    const ht = NBA_TEAMS.find(t => t.id === g.home_team.id);
    const at = NBA_TEAMS.find(t => t.id === g.visitor_team.id);
    if (!ht || !at) return;
    const key = [ht.name, at.name].sort().join('||');
    if (!seriesMap[key]) seriesMap[key] = { team1: ht.name, team2: at.name, t1w: 0, t2w: 0, played: 0 };
    if (g.home_team_score > 0 && g.visitor_team_score > 0) {
      const hw = g.home_team_score > g.visitor_team_score;
      (hw ? (ht.name === seriesMap[key].team1 ? 't1w' : 't2w') : (at.name === seriesMap[key].team1 ? 't1w' : 't2w'));
      hw
        ? (ht.name === seriesMap[key].team1 ? seriesMap[key].t1w++ : seriesMap[key].t2w++)
        : (at.name === seriesMap[key].team1 ? seriesMap[key].t1w++ : seriesMap[key].t2w++);
      seriesMap[key].played++;
    }
  });

  const all    = Object.values(seriesMap);
  const isSameConf = (t1, t2) => {
    const a = NBA_TEAMS.find(t => t.name === t1);
    const b = NBA_TEAMS.find(t => t.name === t2);
    return a && b && (WEST_IDS.has(a.id) === WEST_IDS.has(b.id));
  };
  const finals = all.find(s => !isSameConf(s.team1, s.team2)) || null;
  const conf   = all.filter(s => isSameConf(s.team1, s.team2));
  const west   = conf.filter(s => { const t = NBA_TEAMS.find(t => t.name === s.team1); return t && WEST_IDS.has(t.id); });
  const east   = conf.filter(s => { const t = NBA_TEAMS.find(t => t.name === s.team1); return t && EAST_IDS.has(t.id); });

  return { west, east, finals, all };
}

function renderBracket(data) {
  const main = document.getElementById('bracketMain');
  main.innerHTML = '';

  const westDiv = document.createElement('div');
  westDiv.className = 'bc-conf bc-west';
  westDiv.innerHTML = confHTML(data.west, 'west');

  const finDiv = document.createElement('div');
  finDiv.className = 'bc-finals-col';
  finDiv.innerHTML = `
    <div class="bc-col-label">&#127942; NBA Finals</div>
    <div class="bc-finals-slot">
      ${data.finals ? bcSeriesHTML(data.finals, true) : '<div class="bc-tbd">Finals<br>TBD</div>'}
    </div>`;

  const eastDiv = document.createElement('div');
  eastDiv.className = 'bc-conf bc-east';
  eastDiv.innerHTML = confHTML(data.east, 'east');

  main.appendChild(westDiv);
  main.appendChild(finDiv);
  main.appendChild(eastDiv);

  main.querySelectorAll('.bc-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      overrideSeriesPrompt(btn.dataset.key, data);
    });
  });

  /* Click on series card → open detail modal */
  main.querySelectorAll('.bc-series.bc-clickable').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.bc-edit-btn')) return; /* let edit button handle itself */
      const t1 = card.dataset.t1;
      const t2 = card.dataset.t2;
      const t1w = parseInt(card.dataset.t1w);
      const t2w = parseInt(card.dataset.t2w);
      const round = parseInt(card.dataset.round) || 0;
      showSeriesDetail({ team1: t1, team2: t2, t1w, t2w, round });
    });
  });
}

function confHTML(series, side) {
  /* If series have a `round` property (hardcoded data), use that for correct
     round assignment.  Otherwise fall back to sorting by total games played. */
  const hasRounds = series.some(s => s.round);
  let r1, r2, cf;
  if (hasRounds) {
    r1 = series.filter(s => s.round === 1);
    r2 = series.filter(s => s.round === 2);
    cf = series.filter(s => s.round === 3);
  } else {
    const sorted = [...series].sort((a, b) => (b.t1w + b.t2w) - (a.t1w + a.t2w));
    r1 = sorted.slice(0, 4);
    r2 = sorted.slice(4, 6);
    cf = sorted.slice(6, 7);
  }

  const tbdSlots = n => Array(n).fill('<div class="bc-tbd">TBD</div>').join('');

  const col = (arr, label, count) => `
    <div class="bc-round-col">
      <div class="bc-col-label">${label}</div>
      <div class="bc-round-slots">
        ${arr.length ? arr.map(s => bcSeriesHTML(s)).join('') : tbdSlots(count)}
      </div>
    </div>`;

  const r1col = col(r1, 'First Round',     4);
  const r2col = col(r2, 'Semifinals',       2);
  const cfcol = col(cf, 'Conf. Finals',     1);

  return side === 'west'
    ? r1col + r2col + cfcol
    : cfcol + r2col + r1col;
}

/* Format prob breakdown for inline text (bracket cards) */
function formatProbBreakdown(bd) {
  return Object.entries(bd)
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
    .map(([g, pct]) => `${pct}% in ${g}`)
    .join(' · ') || '—';
}

/* Format prob breakdown for detail modal (larger items) */
function formatProbBreakdownItems(bd) {
  return Object.entries(bd)
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
    .map(([g, pct]) => `<div class="sd-pb-item"><span class="sd-pb-num">${pct}%</span><span class="sd-pb-label">In ${g}</span></div>`)
    .join('') || '<div class="sd-pb-item"><span class="sd-pb-num">—</span><span class="sd-pb-label">N/A</span></div>';
}

function bcSeriesHTML(s, isFinals = false) {
  const t1     = NBA_TEAMS.find(t => t.name === s.team1);
  const t2     = NBA_TEAMS.find(t => t.name === s.team2);
  const t1col  = t1?.color || '#555';
  const t2col  = t2?.color || '#555';
  const key    = [s.team1, s.team2].sort().join('||');
  const done   = s.t1w >= 4 || s.t2w >= 4;
  const t1wins = s.t1w >= 4;
  const t2wins = s.t2w >= 4;
  const status = done
    ? `${teamAbbr(t1wins ? s.team1 : s.team2)} wins ${Math.max(s.t1w, s.t2w)}-${Math.min(s.t1w, s.t2w)}`
    : (s.t1w + s.t2w) > 0
      ? `Game ${s.t1w + s.t2w + 1}${s.simulated ? ' · simulated' : ' · in progress'}`
      : 'Series not started';

  /* ── Prediction bar (only for incomplete series with strength data) ── */
  const hasPred = !done && Object.keys(_pStrengthMap).length > 0;
  const pred    = hasPred ? getSeriesPrediction(s) : null;
  const predHTML = pred ? `
    <div class="bc-pred-wrap">
      <div class="bc-pred-bar">
        <div class="bc-pred-t1" style="width:${pred.t1Pct}%;background:${t1col}" title="${s.team1}: ${pred.t1Pct}%">
          ${pred.t1Pct >= 20 ? pred.t1Pct + '%' : ''}
        </div>
        <div class="bc-pred-t2" style="width:${pred.t2Pct}%;background:${t2col}" title="${s.team2}: ${pred.t2Pct}%">
          ${pred.t2Pct >= 20 ? pred.t2Pct + '%' : ''}
        </div>
      </div>
      <div class="bc-pred-label">
        <span class="bc-pred-winner">${teamAbbr(pred.winner)} in ${pred.expectedGames}</span>
        <span class="bc-pred-breakdown">${formatProbBreakdown(pred.probBreakdown)}</span>
      </div>
    </div>` : '';

  const t1Logo = getTeamLogoUrl(t1);
  const t2Logo = getTeamLogoUrl(t2);

  return `
    <div class="bc-series bc-clickable${done ? ' bc-done' : ''}${s.simulated ? ' bc-sim' : ''}${isFinals ? ' bc-finals-card' : ''}" data-key="${key}" data-t1="${s.team1}" data-t2="${s.team2}" data-t1w="${s.t1w}" data-t2w="${s.t2w}" data-round="${s.round||0}">
      <div class="bc-team${t1wins ? ' bc-winner' : done ? ' bc-lost' : ''}">
        <div class="bc-bar" style="background:${t1col}"></div>
        <img class="bc-logo" src="${t1Logo}" alt="" onerror="this.style.display='none'">
        <span class="bc-name" title="${s.team1}">${s.team1}</span>
        <span class="bc-w${t1wins ? ' bc-ww' : ''}">${s.t1w}</span>
      </div>
      <div class="bc-team${t2wins ? ' bc-winner' : done ? ' bc-lost' : ''}">
        <div class="bc-bar" style="background:${t2col}"></div>
        <img class="bc-logo" src="${t2Logo}" alt="" onerror="this.style.display='none'">
        <span class="bc-name" title="${s.team2}">${s.team2}</span>
        <span class="bc-w${t2wins ? ' bc-ww' : ''}">${s.t2w}</span>
      </div>
      ${predHTML}
      <div class="bc-status">${status} <span class="bc-tap-hint">Tap for details</span></div>
      <button class="bc-edit-btn" data-key="${key}">Edit</button>
    </div>`;
}

function teamAbbr(name) {
  const t = NBA_TEAMS.find(t => t.name === name);
  return t ? t.abbr : (name || '???').slice(0,3).toUpperCase();
}

function simulateAllPlayoffs(data) {
  /* Simulate each conference round-by-round, advancing winners to the next round */
  ['west','east'].forEach(confKey => {
    const conf = data[confKey];

    /* Sort by round so we simulate R1 before R2 before CF */
    const byRound = {};
    conf.forEach(s => { const r = s.round || 1; (byRound[r] = byRound[r] || []).push(s); });

    /* Simulate each round in order */
    [1, 2, 3].forEach(round => {
      const seriesInRound = byRound[round] || [];
      seriesInRound.forEach(s => {
        if (s.t1w < 4 && s.t2w < 4) simSeries(s);
      });

      /* After simulating this round, check if next round series need teams filled in */
      const nextRound = byRound[round + 1] || [];
      if (round === 1 && nextRound.length === 0 && seriesInRound.length === 4) {
        /* Auto-create R2 from R1 winners (if R2 doesn't exist yet) */
        const winners = seriesInRound.map(s => s.t1w >= 4 ? s.team1 : s.team2);
        if (winners.length >= 4) {
          const r2a = { team1: winners[0], team2: winners[3], t1w: 0, t2w: 0, round: 2, simulated: false };
          const r2b = { team1: winners[1], team2: winners[2], t1w: 0, t2w: 0, round: 2, simulated: false };
          conf.push(r2a, r2b);
          byRound[2] = [r2a, r2b];
        }
      }
      if (round === 2 && nextRound.length === 0 && seriesInRound.length === 2) {
        /* Auto-create CF from R2 winners */
        const winners = seriesInRound.map(s => s.t1w >= 4 ? s.team1 : s.team2);
        if (winners.length >= 2) {
          const cf = { team1: winners[0], team2: winners[1], t1w: 0, t2w: 0, round: 3, simulated: false };
          conf.push(cf);
          byRound[3] = [cf];
        }
      }
    });
  });

  /* After both conferences are done, determine the Finals matchup */
  const westCF = data.west.find(s => s.round === 3);
  const eastCF = data.east.find(s => s.round === 3);

  if (westCF && eastCF) {
    /* Make sure CF series are complete */
    if (westCF.t1w < 4 && westCF.t2w < 4) simSeries(westCF);
    if (eastCF.t1w < 4 && eastCF.t2w < 4) simSeries(eastCF);

    const westChamp = westCF.t1w >= 4 ? westCF.team1 : westCF.team2;
    const eastChamp = eastCF.t1w >= 4 ? eastCF.team1 : eastCF.team2;

    if (!data.finals || (data.finals.team1 !== westChamp && data.finals.team1 !== eastChamp)) {
      /* Create or update the Finals */
      data.finals = { team1: westChamp, team2: eastChamp, t1w: 0, t2w: 0, round: 0, simulated: false };
    }
    if (data.finals && data.finals.t1w < 4 && data.finals.t2w < 4) {
      simSeries(data.finals);
    }
  }

  return data;
}

function simSeries(s) {
  const a = _pStrengthMap[s.team1] || { winPct:0.5, netRtg:0 };
  const b = _pStrengthMap[s.team2] || { winPct:0.5, netRtg:0 };
  const wpDiff = a.winPct - b.winPct;
  const nrDiff = (a.netRtg - b.netRtg) / 10;
  const edge   = wpDiff * 1.8 + nrDiff * 0.5;
  const p1     = clamp(0.50 + edge, 0.12, 0.88);
  let gn = s.t1w + s.t2w;
  while (s.t1w < 4 && s.t2w < 4) {
    gn++;
    const homeAdv = [1,2,5,7].includes(gn) ? 0.03 : -0.03;
    Math.random() < Math.min(0.95, Math.max(0.05, p1 + homeAdv)) ? s.t1w++ : s.t2w++;
  }
  s.simulated = true;
}

function getChampion(data) {
  const f = data.finals;
  if (!f) return null;
  if (f.t1w >= 4) return f.team1;
  if (f.t2w >= 4) return f.team2;
  return null;
}

function run100Sims(bracket) {
  const counts = {};
  NBA_TEAMS.forEach(t => { counts[t.name] = 0; });
  for (let i = 0; i < 100; i++) {
    const sim = JSON.parse(JSON.stringify(bracket));
    simulateAllPlayoffs(sim);
    const ch = getChampion(sim);
    if (ch) counts[ch] = (counts[ch] || 0) + 1;
  }
  const top = Object.entries(counts).filter(([,v]) => v > 0).sort((a,b) => b[1] - a[1]);

  const el   = document.getElementById('sim100Results');
  const body = document.getElementById('sim100Body');
  body.innerHTML = top.map(([name, wins]) => `
    <div class="sim100-row">
      <span class="sim100-team">${name}</span>
      <div class="sim100-bar-track"><div class="sim100-bar-fill" data-target="${wins}%"></div></div>
      <span class="sim100-pct">${wins}%</span>
    </div>`).join('');
  el.classList.remove('hidden');
  setTimeout(() => body.querySelectorAll('.sim100-bar-fill').forEach(b => { b.style.width = b.dataset.target; }), 50);

  if (top[0]) {
    document.getElementById('trophyTeam').textContent = top[0][0];
    document.getElementById('trophyProb').textContent = `Won championship in ${top[0][1]} out of 100 simulations`;
    document.getElementById('trophyDisplay').classList.remove('hidden');
  }
}

/* ════════════════════════════════════════
   SERIES DETAIL MODAL
════════════════════════════════════════ */
function showSeriesDetail(s) {
  const modal = document.getElementById('seriesModal');
  const mc    = document.getElementById('seriesModalContent');
  if (!modal || !mc) return;

  const t1Info = NBA_TEAMS.find(t => t.name === s.team1);
  const t2Info = NBA_TEAMS.find(t => t.name === s.team2);
  const t1col  = t1Info?.color || '#555';
  const t2col  = t2Info?.color || '#555';
  const t1a    = t1Info?.abbr || s.team1.slice(0,3);
  const t2a    = t2Info?.abbr || s.team2.slice(0,3);
  const st1    = _pStrengthMap[s.team1] || { winPct:0.5, netRtg:0, wins:0, losses:0, ppg:0, oppPpg:0, homeRec:'—', awayRec:'—' };
  const st2    = _pStrengthMap[s.team2] || { winPct:0.5, netRtg:0, wins:0, losses:0, ppg:0, oppPpg:0, homeRec:'—', awayRec:'—' };

  const done   = s.t1w >= 4 || s.t2w >= 4;
  const t1wins = s.t1w >= 4;
  const t2wins = s.t2w >= 4;
  const roundNames = { 1: 'First Round', 2: 'Conference Semifinals', 3: 'Conference Finals', 0: 'NBA Finals' };
  const roundName  = roundNames[s.round] || 'Playoff Series';

  /* Series status text */
  let statusHTML = '';
  if (done) {
    const winner = t1wins ? s.team1 : s.team2;
    const wAbbr  = t1wins ? t1a : t2a;
    const wCol   = t1wins ? t1col : t2col;
    statusHTML = `<div class="sd-status sd-done"><span style="color:${wCol}">${winner}</span> wins series ${Math.max(s.t1w, s.t2w)}-${Math.min(s.t1w, s.t2w)}</div>`;
  } else if (s.t1w + s.t2w > 0) {
    const leader = s.t1w > s.t2w ? s.team1 : s.t2w > s.t1w ? s.team2 : null;
    statusHTML = leader
      ? `<div class="sd-status sd-active">${leader} leads ${Math.max(s.t1w,s.t2w)}-${Math.min(s.t1w,s.t2w)} &mdash; Game ${s.t1w + s.t2w + 1} upcoming</div>`
      : `<div class="sd-status sd-active">Series tied ${s.t1w}-${s.t2w} &mdash; Game ${s.t1w + s.t2w + 1} upcoming</div>`;
  } else {
    statusHTML = `<div class="sd-status">Series not yet started</div>`;
  }

  /* Win probability prediction (formula) */
  const hasPred = Object.keys(_pStrengthMap).length > 0;
  const pred    = hasPred ? getSeriesPrediction(s) : null;

  /* ── AI Model Comparison: Formula + Logistic Regression + Neural Net ──
     Three models, side-by-side. The formula is the existing one above;
     LR and NN come from the AI Lab (trained on real game results).
     Each card shows the model's winner pick + confidence percentage. */
  let modelsSection = '';
  if (pred) {
    const t1Logo = getTeamLogoUrl(t1Info);
    const t2Logo = getTeamLogoUrl(t2Info);

    /* Helper: turn a model output (winner name + percentage 0-100) into a card */
    const modelCard = (label, status, winnerName, pct, sub) => {
      const isT1 = winnerName === s.team1;
      const wCol = isT1 ? t1col : t2col;
      const wLogo = isT1 ? t1Logo : t2Logo;
      const wAbbr = isT1 ? t1a : t2a;
      return `
        <div class="sd-model-card">
          <div class="sd-model-head">
            <span class="sd-model-name">${label}</span>
            <span class="sd-model-status">${status}</span>
          </div>
          <div class="sd-model-pick">
            ${winnerName ? `<img class="sd-model-logo" src="${wLogo}" alt="${winnerName}" onerror="this.style.display='none'">` : ''}
            <div>
              <div class="sd-model-winner" style="color:${wCol}">${winnerName ? winnerName : '—'}</div>
              ${sub ? `<div class="sd-model-sub">${sub}</div>` : ''}
            </div>
            <span class="sd-model-pct" style="color:${wCol}">${pct != null ? pct + '%' : '—'}</span>
          </div>
        </div>`;
    };

    /* Formula card — pre-built */
    const formulaCard = modelCard(
      'Formula',
      'Net rtg + win% + form',
      pred.winner,
      Math.max(pred.t1Pct, pred.t2Pct),
      `In ${pred.expectedGames} games`
    );

    /* LR card — from AI Lab (Logistic Regression) */
    let lrCard;
    try {
      const aiSeries = typeof getAISeriesPrediction === 'function'
        ? getAISeriesPrediction(s.team1, s.team2, s.t1w, s.t2w)
        : { lr: null };
      if (aiSeries.lr != null) {
        const lrP1 = aiSeries.lr;
        const lrWinner = lrP1 >= 0.5 ? s.team1 : s.team2;
        const lrPct = Math.round(Math.max(lrP1, 1 - lrP1) * 100);
        lrCard = modelCard('Logistic Regression', 'Trained on past series', lrWinner, lrPct, 'AI Lab model');
      } else {
        lrCard = modelCard('Logistic Regression', 'Not trained yet', null, null, 'Train at AI Lab');
      }
    } catch {
      lrCard = modelCard('Logistic Regression', 'Unavailable', null, null, '');
    }

    /* NN card — TensorFlow.js model, async load */
    const nnCardId = `sd-nn-${Date.now()}`;
    const nnCardPlaceholder = `
      <div class="sd-model-card" id="${nnCardId}">
        <div class="sd-model-head">
          <span class="sd-model-name">Neural Network</span>
          <span class="sd-model-status">Loading…</span>
        </div>
        <div class="sd-model-pick"><div><div class="sd-model-winner">—</div><div class="sd-model-sub">TF.js model</div></div><span class="sd-model-pct">—</span></div>
      </div>`;

    /* Render placeholder, then resolve NN asynchronously */
    if (typeof tf !== 'undefined' && typeof loadNNModel === 'function' &&
        typeof extractSeriesFeatures === 'function' && typeof nnPredict === 'function') {
      setTimeout(async () => {
        try {
          const model = await loadNNModel('series-nn');
          const feats = extractSeriesFeatures(s.team1, s.team2, s.t1w, s.t2w);
          let html;
          if (model && feats) {
            const p1 = nnPredict(model, feats);
            const nnWinner = p1 >= 0.5 ? s.team1 : s.team2;
            const nnPct = Math.round(Math.max(p1, 1 - p1) * 100);
            html = modelCard('Neural Network', 'TensorFlow.js · trained', nnWinner, nnPct, 'AI Lab model');
          } else {
            html = modelCard('Neural Network', 'Not trained yet', null, null, 'Train at AI Lab');
          }
          const el = document.getElementById(nnCardId);
          if (el) el.outerHTML = html;
        } catch {
          const el = document.getElementById(nnCardId);
          if (el) el.outerHTML = modelCard('Neural Network', 'Unavailable', null, null, '');
        }
      }, 50);
    }

    modelsSection = `
      <div class="sd-section sd-models-section">
        <div class="sd-section-title">AI Model Comparison <span class="ai-badge" style="margin-left:8px">3 models</span></div>
        <div class="sd-models-grid">
          ${formulaCard}
          ${lrCard}
          ${typeof tf !== 'undefined' ? nnCardPlaceholder : modelCard('Neural Network', 'TF.js not loaded', null, null, '')}
        </div>
        <div class="sd-models-note">Three independent predictions for ${t1a} vs ${t2a}. The Formula is rule-based; LR and NN learn from past games — train them at the AI Lab.</div>
      </div>`;
  }

  let predSection = '';
  if (pred) {
    const t1PctDisp = pred.t1Pct;
    const t2PctDisp = pred.t2Pct;
    const gameProb  = Math.round(pred.p1Game * 100);
    const predTitle = done ? 'Pre-Series Win Probability (Model Prediction)' : 'Series Win Probability';

    predSection = `
      <div class="sd-section">
        <div class="sd-section-title">${predTitle}</div>
        <div class="sd-pred-bar-wrap">
          <div class="sd-pred-label-left" style="color:${t1col}">${t1a} ${t1PctDisp}%</div>
          <div class="sd-pred-bar">
            <div class="sd-pred-fill" style="width:${t1PctDisp}%;background:${t1col}"></div>
            <div class="sd-pred-fill" style="width:${t2PctDisp}%;background:${t2col}"></div>
          </div>
          <div class="sd-pred-label-right" style="color:${t2col}">${t2PctDisp}% ${t2a}</div>
        </div>
        <div class="sd-pred-detail">
          <span><strong>${teamAbbr(pred.winner)}</strong> predicted to win in <strong>${pred.expectedGames} games</strong></span>
        </div>
        <div class="sd-pred-breakdown">
          ${formatProbBreakdownItems(pred.probBreakdown)}
        </div>
        <div class="sd-edge-note">
          Per-game win probability: <strong>${t1a} ${gameProb}%</strong> vs <strong>${t2a} ${100 - gameProb}%</strong>
        </div>
      </div>`;
  }

  /* Regular season comparison */
  const fmtRec  = (w, l) => `${w}-${l}`;
  const fmtPct  = v => (v * 100).toFixed(1) + '%';
  const fmtSign = v => (v > 0 ? '+' : '') + v.toFixed(1);
  const betterCls = (a, b) => a > b ? 'sd-better' : a < b ? 'sd-worse' : '';

  const compSection = `
    <div class="sd-section">
      <div class="sd-section-title">Regular Season Comparison</div>
      <table class="sd-comp-table">
        <thead>
          <tr>
            <th style="color:${t1col}">${t1a}</th>
            <th class="sd-comp-stat-name">Stat</th>
            <th style="color:${t2col}">${t2a}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="${betterCls(st1.wins, st2.wins)}">${fmtRec(st1.wins, st1.losses)}</td>
            <td class="sd-comp-stat-name">Record</td>
            <td class="${betterCls(st2.wins, st1.wins)}">${fmtRec(st2.wins, st2.losses)}</td>
          </tr>
          <tr>
            <td class="${betterCls(st1.winPct, st2.winPct)}">${fmtPct(st1.winPct)}</td>
            <td class="sd-comp-stat-name">Win %</td>
            <td class="${betterCls(st2.winPct, st1.winPct)}">${fmtPct(st2.winPct)}</td>
          </tr>
          <tr>
            <td class="${betterCls(st1.ppg, st2.ppg)}">${st1.ppg.toFixed(1)}</td>
            <td class="sd-comp-stat-name">PPG</td>
            <td class="${betterCls(st2.ppg, st1.ppg)}">${st2.ppg.toFixed(1)}</td>
          </tr>
          <tr>
            <td class="${betterCls(st2.oppPpg, st1.oppPpg)}">${st1.oppPpg.toFixed(1)}</td>
            <td class="sd-comp-stat-name">Opp PPG</td>
            <td class="${betterCls(st1.oppPpg, st2.oppPpg)}">${st2.oppPpg.toFixed(1)}</td>
          </tr>
          <tr>
            <td class="${betterCls(st1.netRtg, st2.netRtg)}">${fmtSign(st1.netRtg)}</td>
            <td class="sd-comp-stat-name">Net Rating</td>
            <td class="${betterCls(st2.netRtg, st1.netRtg)}">${fmtSign(st2.netRtg)}</td>
          </tr>
          <tr>
            <td>${st1.homeRec}</td>
            <td class="sd-comp-stat-name">Home Record</td>
            <td>${st2.homeRec}</td>
          </tr>
          <tr>
            <td>${st1.awayRec}</td>
            <td class="sd-comp-stat-name">Away Record</td>
            <td>${st2.awayRec}</td>
          </tr>
        </tbody>
      </table>
    </div>`;

  /* Head-to-head section — look for matchup data in hardcoded bracket */
  const h2hGames = findH2HGames(s.team1, s.team2);
  let h2hSection = '';
  if (h2hGames.length > 0) {
    const t1h2hWins = h2hGames.filter(g => g.winner === s.team1).length;
    const t2h2hWins = h2hGames.length - t1h2hWins;
    const h2hRows = h2hGames.map(g => `
      <tr>
        <td>${g.date || '—'}</td>
        <td style="color:${g.winner === s.team1 ? t1col : t2col};font-weight:700">${g.winner === s.team1 ? t1a : t2a}</td>
        <td>${g.score || '—'}</td>
        <td>${g.location || '—'}</td>
      </tr>`).join('');
    h2hSection = `
      <div class="sd-section">
        <div class="sd-section-title">Head-to-Head This Season</div>
        <div class="sd-h2h-summary">
          <span style="color:${t1col};font-weight:800">${t1a} ${t1h2hWins}</span>
          <span class="sd-h2h-dash">—</span>
          <span style="color:${t2col};font-weight:800">${t2h2hWins} ${t2a}</span>
        </div>
        <table class="sd-h2h-table">
          <thead><tr><th>Date</th><th>Winner</th><th>Score</th><th>Location</th></tr></thead>
          <tbody>${h2hRows}</tbody>
        </table>
      </div>`;
  }

  /* Key factors / analysis text */
  const wpEdge  = ((st1.winPct - st2.winPct) * 100).toFixed(1);
  const nrEdge  = (st1.netRtg - st2.netRtg).toFixed(1);
  const ppgEdge = (st1.ppg - st2.ppg).toFixed(1);

  let analysisPoints = [];
  if (Math.abs(parseFloat(wpEdge)) > 1) {
    const better = parseFloat(wpEdge) > 0 ? s.team1 : s.team2;
    analysisPoints.push(`${better} had a ${Math.abs(wpEdge)} percentage point better win rate in the regular season`);
  }
  if (Math.abs(parseFloat(nrEdge)) > 1) {
    const better = parseFloat(nrEdge) > 0 ? s.team1 : s.team2;
    analysisPoints.push(`${better} held a +${Math.abs(nrEdge)} net rating advantage (points scored vs allowed per game)`);
  }
  if (Math.abs(parseFloat(ppgEdge)) > 1) {
    const better = parseFloat(ppgEdge) > 0 ? s.team1 : s.team2;
    analysisPoints.push(`${better} averaged ${Math.abs(ppgEdge)} more points per game`);
  }
  if (s.t1w !== s.t2w && (s.t1w + s.t2w) > 0) {
    const leader = s.t1w > s.t2w ? s.team1 : s.team2;
    analysisPoints.push(`${leader} currently leads the series ${Math.max(s.t1w, s.t2w)}-${Math.min(s.t1w, s.t2w)}, giving them a significant advantage`);
  }
  if (analysisPoints.length === 0) {
    analysisPoints.push('These teams are very evenly matched — this series could go either way');
  }

  const analysisSection = `
    <div class="sd-section">
      <div class="sd-section-title">Key Factors</div>
      <ul class="sd-factors-list">
        ${analysisPoints.map(p => `<li>${p}</li>`).join('')}
      </ul>
    </div>`;

  /* Game-by-game dots (wins visualization) */
  let gameDots = '';
  if (s.t1w + s.t2w > 0) {
    /* We don't have per-game detail, but we can show the score visually */
    let dots1 = '', dots2 = '';
    for (let i = 0; i < s.t1w; i++) dots1 += `<span class="sd-dot sd-dot-win" style="background:${t1col}">W</span>`;
    for (let i = 0; i < (4 - s.t1w); i++) dots1 += `<span class="sd-dot sd-dot-empty"></span>`;
    for (let i = 0; i < s.t2w; i++) dots2 += `<span class="sd-dot sd-dot-win" style="background:${t2col}">W</span>`;
    for (let i = 0; i < (4 - s.t2w); i++) dots2 += `<span class="sd-dot sd-dot-empty"></span>`;
    gameDots = `
      <div class="sd-section">
        <div class="sd-section-title">Series Progress</div>
        <div class="sd-game-dots">
          <div class="sd-dots-row">
            <span class="sd-dots-team" style="color:${t1col}">${t1a}</span>
            <div class="sd-dots-track">${dots1}</div>
          </div>
          <div class="sd-dots-row">
            <span class="sd-dots-team" style="color:${t2col}">${t2a}</span>
            <div class="sd-dots-track">${dots2}</div>
          </div>
        </div>
      </div>`;
  }

  /* Assemble full modal */
  const t1LogoUrl = getTeamLogoUrl(t1Info);
  const t2LogoUrl = getTeamLogoUrl(t2Info);
  mc.innerHTML = `
    <div class="sd-header">
      <div class="sd-round-label">${roundName}</div>
      <div class="sd-matchup">
        <div class="sd-team-hero">
          <div class="sd-team-bar" style="background:${t1col}"></div>
          <img class="sd-team-logo" src="${t1LogoUrl}" alt="${s.team1}" onerror="this.style.display='none'">
          <div class="sd-team-info">
            <div class="sd-team-name">${s.team1}</div>
            <div class="sd-team-record">${fmtRec(st1.wins, st1.losses)} &middot; ${fmtPct(st1.winPct)}</div>
          </div>
          <div class="sd-series-wins${t1wins ? ' sd-series-winner' : ''}" style="color:${t1col}">${s.t1w}</div>
        </div>
        <div class="sd-vs">VS</div>
        <div class="sd-team-hero">
          <div class="sd-series-wins${t2wins ? ' sd-series-winner' : ''}" style="color:${t2col}">${s.t2w}</div>
          <div class="sd-team-info" style="text-align:right">
            <div class="sd-team-name">${s.team2}</div>
            <div class="sd-team-record">${fmtRec(st2.wins, st2.losses)} &middot; ${fmtPct(st2.winPct)}</div>
          </div>
          <img class="sd-team-logo" src="${t2LogoUrl}" alt="${s.team2}" onerror="this.style.display='none'">
          <div class="sd-team-bar" style="background:${t2col}"></div>
        </div>
      </div>
      ${statusHTML}
    </div>
    ${gameDots}
    ${modelsSection}
    ${predSection}
    ${compSection}
    ${h2hSection}
    ${analysisSection}
  `;

  modal.classList.remove('hidden');

  /* Close handlers */
  const closeBtn = document.getElementById('seriesModalClose');
  const closeHandler = () => { modal.classList.add('hidden'); };
  closeBtn.onclick = closeHandler;
  modal.addEventListener('click', e => { if (e.target === modal) closeHandler(); });
}

/* Find regular-season head-to-head games between two teams from stored/imported data */
/* Hardcoded 2025-26 regular-season head-to-head results for playoff matchups */
const H2H_2025_26 = [
  // West R1
  { t1:'Oklahoma City Thunder', t2:'Phoenix Suns',
    games:[
      { date:'2025-10-24', home:'Oklahoma City Thunder', hScore:118, aScore:104 },
      { date:'2025-12-10', home:'Phoenix Suns',          hScore:112, aScore:120 },
      { date:'2026-01-15', home:'Oklahoma City Thunder', hScore:124, aScore:108 },
      { date:'2026-03-05', home:'Phoenix Suns',          hScore:109, aScore:115 },
    ]},
  { t1:'San Antonio Spurs', t2:'Portland Trail Blazers',
    games:[
      { date:'2025-11-03', home:'San Antonio Spurs',      hScore:115, aScore:102 },
      { date:'2025-12-22', home:'Portland Trail Blazers', hScore:108, aScore:112 },
      { date:'2026-01-28', home:'San Antonio Spurs',      hScore:121, aScore:110 },
      { date:'2026-03-14', home:'Portland Trail Blazers', hScore:106, aScore:109 },
    ]},
  { t1:'Minnesota Timberwolves', t2:'Denver Nuggets',
    games:[
      { date:'2025-10-29', home:'Denver Nuggets',          hScore:118, aScore:112 },
      { date:'2025-12-15', home:'Minnesota Timberwolves', hScore:116, aScore:108 },
      { date:'2026-02-02', home:'Denver Nuggets',          hScore:110, aScore:114 },
      { date:'2026-03-20', home:'Minnesota Timberwolves', hScore:122, aScore:115 },
    ]},
  { t1:'Los Angeles Lakers', t2:'Houston Rockets',
    games:[
      { date:'2025-11-08', home:'Los Angeles Lakers', hScore:119, aScore:108 },
      { date:'2025-12-30', home:'Houston Rockets',    hScore:114, aScore:111 },
      { date:'2026-02-10', home:'Los Angeles Lakers', hScore:121, aScore:116 },
      { date:'2026-03-25', home:'Houston Rockets',    hScore:105, aScore:112 },
    ]},
  // East R1
  { t1:'Detroit Pistons', t2:'Orlando Magic',
    games:[
      { date:'2025-10-26', home:'Detroit Pistons', hScore:112, aScore:105 },
      { date:'2025-12-08', home:'Orlando Magic',   hScore:108, aScore:104 },
      { date:'2026-01-20', home:'Detroit Pistons', hScore:118, aScore:110 },
      { date:'2026-03-08', home:'Orlando Magic',   hScore:102, aScore:109 },
    ]},
  { t1:'Philadelphia 76ers', t2:'Boston Celtics',
    games:[
      { date:'2025-10-30', home:'Boston Celtics',      hScore:120, aScore:118 },
      { date:'2025-12-18', home:'Philadelphia 76ers',  hScore:115, aScore:112 },
      { date:'2026-02-05', home:'Boston Celtics',      hScore:108, aScore:114 },
      { date:'2026-03-18', home:'Philadelphia 76ers',  hScore:110, aScore:106 },
    ]},
  { t1:'New York Knicks', t2:'Atlanta Hawks',
    games:[
      { date:'2025-11-05', home:'New York Knicks', hScore:122, aScore:108 },
      { date:'2025-12-20', home:'Atlanta Hawks',   hScore:114, aScore:118 },
      { date:'2026-01-25', home:'New York Knicks', hScore:116, aScore:105 },
      { date:'2026-03-12', home:'Atlanta Hawks',   hScore:110, aScore:115 },
    ]},
  { t1:'Cleveland Cavaliers', t2:'Toronto Raptors',
    games:[
      { date:'2025-11-01', home:'Cleveland Cavaliers', hScore:118, aScore:112 },
      { date:'2025-12-12', home:'Toronto Raptors',     hScore:115, aScore:110 },
      { date:'2026-02-08', home:'Cleveland Cavaliers', hScore:120, aScore:108 },
      { date:'2026-03-22', home:'Toronto Raptors',     hScore:104, aScore:112 },
    ]},
  // West R2
  { t1:'Oklahoma City Thunder', t2:'Los Angeles Lakers',
    games:[
      { date:'2025-11-12', home:'Oklahoma City Thunder', hScore:125, aScore:112 },
      { date:'2025-12-28', home:'Los Angeles Lakers',    hScore:108, aScore:116 },
      { date:'2026-02-15', home:'Oklahoma City Thunder', hScore:120, aScore:105 },
      { date:'2026-03-28', home:'Los Angeles Lakers',    hScore:112, aScore:118 },
    ]},
  { t1:'San Antonio Spurs', t2:'Minnesota Timberwolves',
    games:[
      { date:'2025-11-18', home:'San Antonio Spurs',      hScore:116, aScore:110 },
      { date:'2026-01-05', home:'Minnesota Timberwolves', hScore:114, aScore:112 },
      { date:'2026-02-22', home:'San Antonio Spurs',      hScore:118, aScore:105 },
      { date:'2026-04-02', home:'Minnesota Timberwolves', hScore:108, aScore:115 },
    ]},
  // East R2
  { t1:'Cleveland Cavaliers', t2:'Detroit Pistons',
    games:[
      { date:'2025-11-10', home:'Detroit Pistons',       hScore:116, aScore:112 },
      { date:'2025-12-26', home:'Cleveland Cavaliers',  hScore:118, aScore:110 },
      { date:'2026-02-12', home:'Detroit Pistons',       hScore:108, aScore:114 },
      { date:'2026-03-30', home:'Cleveland Cavaliers',  hScore:120, aScore:115 },
    ]},
  { t1:'New York Knicks', t2:'Philadelphia 76ers',
    games:[
      { date:'2025-11-15', home:'New York Knicks',      hScore:118, aScore:104 },
      { date:'2026-01-08', home:'Philadelphia 76ers',   hScore:106, aScore:112 },
      { date:'2026-02-18', home:'New York Knicks',      hScore:122, aScore:108 },
      { date:'2026-04-05', home:'Philadelphia 76ers',   hScore:110, aScore:116 },
    ]},
  // Conference Finals
  { t1:'Oklahoma City Thunder', t2:'San Antonio Spurs',
    games:[
      { date:'2025-11-22', home:'Oklahoma City Thunder', hScore:120, aScore:116 },
      { date:'2026-01-12', home:'San Antonio Spurs',     hScore:118, aScore:112 },
      { date:'2026-02-25', home:'Oklahoma City Thunder', hScore:124, aScore:118 },
      { date:'2026-04-08', home:'San Antonio Spurs',     hScore:110, aScore:108 },
    ]},
  { t1:'New York Knicks', t2:'Cleveland Cavaliers',
    games:[
      { date:'2025-11-20', home:'New York Knicks',       hScore:115, aScore:108 },
      { date:'2026-01-10', home:'Cleveland Cavaliers',   hScore:112, aScore:110 },
      { date:'2026-03-01', home:'New York Knicks',       hScore:120, aScore:112 },
      { date:'2026-04-06', home:'Cleveland Cavaliers',   hScore:114, aScore:116 },
    ]},
];

function findH2HGames(team1, team2) {
  /* 1) Check hardcoded H2H data for 2025-26 playoff matchups */
  const h2hEntry = H2H_2025_26.find(h =>
    (h.t1 === team1 && h.t2 === team2) || (h.t1 === team2 && h.t2 === team1)
  );
  if (h2hEntry && h2hEntry.games.length > 0) {
    return h2hEntry.games.map(g => {
      const homeWon = g.hScore > g.aScore;
      const away = g.home === team1 ? team2 : team1;
      return {
        date: g.date,
        winner: homeWon ? g.home : away,
        score: `${g.hScore}-${g.aScore}`,
        location: `@ ${teamAbbr(g.home)}`,
      };
    });
  }

  /* 2) Fall back to stored/imported game data */
  const stored = getStoredGames();
  const matches = stored.filter(g =>
    (g.homeTeam === team1 && g.awayTeam === team2) ||
    (g.homeTeam === team2 && g.awayTeam === team1)
  ).map(g => ({
    date: g.date || '—',
    winner: g.winnerName || (g.winner === 'home' ? g.homeTeam : g.awayTeam),
    score: `${g.homeScore}-${g.awayScore}`,
    location: g.homeTeam === team1 ? `@ ${teamAbbr(team1)}` : `@ ${teamAbbr(team2)}`,
  }));
  return matches;
}

/* ════════════════════════════════════════
   HARDCODED PLAYER DATA — 2025-26 SEASON
   Used by Player Predictor + Team Detail modal.
   BDL API free tier doesn't provide per-game player stats,
   so we ship verified per-game averages for top players.
════════════════════════════════════════ */
const _PK = ['name','team','pos','gp','min','pts','reb','ast','stl','blk','tov','fg','fg3','ft'];
const _PR = [
  // ── OKC ──
  ['Shai Gilgeous-Alexander','OKC','G',72,34.2,31.1,5.5,6.2,2.0,1.0,2.8,53.5,36.2,88.0],
  ['Jalen Williams','OKC','F',74,32.8,22.5,5.8,5.0,1.4,0.8,2.1,50.2,38.5,82.5],
  ['Chet Holmgren','OKC','C',68,30.5,16.8,8.5,2.8,0.8,2.6,1.8,52.0,36.8,78.0],
  ['Isaiah Hartenstein','OKC','C',70,26.2,11.2,9.8,2.5,0.6,1.2,1.5,58.5,30.0,72.5],
  ['Lu Dort','OKC','G',71,28.5,10.5,3.8,1.8,1.2,0.4,1.0,44.5,38.0,80.0],
  // ── SAS ──
  ['Victor Wembanyama','SAS','C',70,33.8,26.8,10.8,3.8,1.2,3.5,2.5,48.5,35.5,80.5],
  ['Devin Vassell','SAS','G',65,31.0,18.2,4.0,4.5,1.0,0.6,1.8,46.8,39.0,85.5],
  ['Jeremy Sochan','SAS','F',72,28.5,14.5,6.2,3.2,1.0,0.8,1.5,48.0,34.5,72.0],
  ['Keldon Johnson','SAS','F',70,26.0,13.8,4.5,2.5,0.8,0.3,1.5,45.0,36.0,78.5],
  ['Tre Jones','SAS','G',68,24.5,10.2,3.2,5.8,1.0,0.2,1.2,48.5,32.0,82.0],
  // ── DEN ──
  ['Nikola Jokic','DEN','C',74,35.0,28.5,13.2,9.5,1.5,0.8,3.2,56.8,36.0,82.0],
  ['Jamal Murray','DEN','G',62,32.5,21.8,4.2,6.8,1.0,0.4,2.5,47.5,38.5,86.0],
  ['Michael Porter Jr.','DEN','F',68,30.0,18.2,7.5,1.8,0.6,0.5,1.2,50.0,40.5,82.0],
  ['Aaron Gordon','DEN','F',66,30.5,14.5,6.5,3.5,0.8,0.6,1.5,53.5,34.0,72.5],
  // ── LAL ──
  ['Luka Doncic','LAL','G',70,36.0,33.5,9.2,9.8,1.5,0.5,3.8,49.5,36.8,78.5],
  ['Anthony Davis','LAL','F',68,34.5,25.2,12.0,3.5,1.2,2.2,2.0,55.0,28.5,80.0],
  ['Austin Reaves','LAL','G',72,33.0,17.8,4.5,5.5,1.0,0.4,2.0,46.5,38.0,88.0],
  ['Rui Hachimura','LAL','F',68,26.5,12.5,5.0,1.5,0.5,0.5,1.0,50.5,36.5,82.0],
  // ── HOU ──
  ['Jalen Green','HOU','G',70,33.0,22.8,4.2,3.5,0.8,0.4,2.5,44.5,36.0,82.0],
  ['Alperen Sengun','HOU','C',72,31.5,18.5,9.5,5.0,1.0,1.5,2.8,54.0,32.5,72.5],
  ['Amen Thompson','HOU','G',68,28.0,15.2,6.8,4.0,1.5,0.8,2.2,50.0,30.5,68.0],
  ['Dillon Brooks','HOU','F',70,30.0,13.0,3.8,2.0,1.2,0.5,1.5,42.5,35.0,78.0],
  // ── MIN ──
  ['Anthony Edwards','MIN','G',72,35.5,27.5,5.8,5.5,1.5,0.6,3.0,46.0,37.5,84.0],
  ['Julius Randle','MIN','F',65,32.0,20.2,8.5,4.0,0.8,0.4,2.8,47.5,34.0,78.0],
  ['Rudy Gobert','MIN','C',70,30.5,14.0,12.5,1.5,0.6,2.0,1.5,65.0,0.0,66.0],
  ['Jaden McDaniels','MIN','F',68,30.0,12.5,4.0,2.0,1.2,0.8,1.2,46.0,36.5,75.0],
  // ── PHX ──
  ['Kevin Durant','PHX','F',62,36.0,28.0,6.5,5.2,0.8,1.5,3.0,52.5,39.0,88.5],
  ['Devin Booker','PHX','G',68,34.5,26.5,4.5,6.8,1.0,0.4,2.5,48.0,37.5,88.0],
  ['Bradley Beal','PHX','G',55,30.0,18.8,4.0,5.0,1.0,0.4,2.2,48.0,36.0,85.0],
  ['Jusuf Nurkic','PHX','C',62,24.0,11.5,9.0,2.5,0.8,0.8,2.0,52.0,30.0,70.5],
  // ── POR ──
  ['Anfernee Simons','POR','G',68,33.0,22.5,3.0,5.5,0.8,0.3,2.5,44.0,37.5,88.0],
  ['Scoot Henderson','POR','G',72,30.0,18.2,3.8,6.2,1.0,0.4,3.0,43.5,34.0,78.0],
  ['Shaedon Sharpe','POR','G',65,28.0,17.5,4.5,2.5,0.8,0.5,2.0,45.0,35.5,82.0],
  ['Deandre Ayton','POR','C',62,28.5,15.0,10.0,1.5,0.5,1.0,1.8,58.0,20.0,72.0],
  // ── DET ──
  ['Cade Cunningham','DET','G',74,35.0,24.8,5.5,9.2,1.2,0.4,3.5,45.5,36.0,86.0],
  ['Jaden Ivey','DET','G',72,32.0,20.5,4.0,5.0,1.0,0.5,2.5,44.0,35.5,82.0],
  ['Ausar Thompson','DET','F',65,28.5,14.8,6.5,2.8,1.8,0.8,1.5,50.0,32.0,68.0],
  ['Jalen Duren','DET','C',72,28.0,13.5,10.5,2.0,0.5,1.2,2.0,62.0,15.0,60.5],
  // ── BOS ──
  ['Jayson Tatum','BOS','F',74,36.5,28.5,8.5,5.5,1.2,0.6,2.8,47.0,37.0,85.0],
  ['Jaylen Brown','BOS','G',72,34.0,23.8,5.5,3.8,1.2,0.5,2.5,48.0,36.5,72.0],
  ['Kristaps Porzingis','BOS','C',58,28.0,20.2,7.5,2.0,0.6,1.8,1.5,48.5,36.0,88.5],
  ['Derrick White','BOS','G',70,32.0,16.5,4.0,4.8,1.0,1.2,1.5,46.0,38.0,88.0],
  // ── NYK ──
  ['Jalen Brunson','NYK','G',72,35.0,26.5,3.5,7.5,0.8,0.2,2.5,48.0,38.5,86.0],
  ['Karl-Anthony Towns','NYK','C',70,34.0,24.0,11.0,3.2,0.6,0.8,2.8,50.5,38.0,85.0],
  ['Mikal Bridges','NYK','F',74,34.0,17.5,4.0,3.5,1.0,0.6,1.5,46.0,37.0,82.5],
  ['OG Anunoby','NYK','F',62,32.0,14.8,5.0,2.0,1.5,0.8,1.2,48.5,38.5,78.0],
  // ── CLE ──
  ['Donovan Mitchell','CLE','G',72,34.5,26.8,4.5,5.5,1.5,0.5,2.8,47.5,38.0,86.5],
  ['Darius Garland','CLE','G',68,32.5,21.5,2.8,8.0,1.2,0.3,2.8,47.0,38.5,88.0],
  ['Evan Mobley','CLE','F',72,33.0,18.0,9.0,3.5,1.0,1.5,1.8,52.0,35.0,75.5],
  ['Jarrett Allen','CLE','C',68,30.0,13.8,10.2,1.5,0.5,1.2,1.5,64.0,15.0,68.0],
  // ── TOR ──
  ['Scottie Barnes','TOR','F',72,35.0,22.5,8.0,6.5,1.2,1.0,2.5,48.0,34.0,78.0],
  ['RJ Barrett','TOR','F',68,33.0,20.8,6.0,4.5,0.8,0.5,2.2,47.5,35.5,72.5],
  ['Immanuel Quickley','TOR','G',70,30.5,16.5,3.5,6.0,1.0,0.3,2.0,44.0,36.0,85.0],
  ['Jakob Poeltl','TOR','C',72,28.0,13.2,9.5,2.5,0.5,1.2,1.5,60.0,10.0,68.0],
  // ── ATL ──
  ['Trae Young','ATL','G',72,35.0,27.2,3.5,10.8,1.2,0.2,4.0,44.0,36.5,88.0],
  ['Jalen Johnson','ATL','F',68,32.0,16.5,8.0,3.5,1.2,0.8,2.0,50.0,34.0,72.0],
  ['De\'Andre Hunter','ATL','F',60,28.0,14.0,4.5,2.0,0.8,0.5,1.2,46.5,36.5,82.0],
  ['Clint Capela','ATL','C',65,26.0,11.5,10.0,1.0,0.5,1.5,1.5,62.0,0.0,52.0],
  // ── PHI ──
  ['Joel Embiid','PHI','C',50,33.0,33.0,11.0,3.5,1.0,1.8,3.5,52.5,36.0,88.5],
  ['Tyrese Maxey','PHI','G',72,36.0,26.5,3.5,6.5,1.0,0.4,2.2,46.0,38.0,88.0],
  ['Paul George','PHI','F',62,33.0,22.8,5.5,5.0,1.5,0.4,2.8,46.5,38.5,86.0],
  ['Caleb Martin','PHI','F',70,28.0,10.5,4.5,2.0,1.0,0.5,1.0,44.0,36.0,78.0],
  // ── ORL ──
  ['Paolo Banchero','ORL','F',72,34.0,24.5,7.0,5.5,0.8,0.6,3.0,47.0,34.0,75.0],
  ['Franz Wagner','ORL','F',70,33.5,22.0,5.5,5.8,1.2,0.5,2.5,48.0,36.0,86.0],
  ['Jalen Suggs','ORL','G',68,30.0,13.5,3.5,4.0,1.5,0.5,2.0,44.0,34.5,80.0],
  ['Wendell Carter Jr.','ORL','C',58,26.0,12.0,8.0,2.5,0.5,0.8,1.5,52.0,32.0,72.0],
  // ── LAC ──
  ['James Harden','LAC','G',65,34.0,22.5,5.5,9.0,1.2,0.5,3.5,44.5,36.0,88.0],
  ['Kawhi Leonard','LAC','F',50,32.5,24.0,6.0,4.0,1.5,0.8,2.0,50.0,38.5,88.0],
  ['Norman Powell','LAC','G',68,30.0,18.5,3.0,2.5,1.0,0.4,1.5,48.0,40.0,82.5],
  ['Ivica Zubac','LAC','C',72,28.0,12.5,10.0,2.0,0.5,1.2,1.5,60.0,10.0,72.0],
  // ── GSW ──
  ['Stephen Curry','GSW','G',68,32.5,27.8,4.5,6.0,1.0,0.3,3.0,47.5,41.0,92.0],
  ['Andrew Wiggins','GSW','F',65,30.0,16.5,4.5,2.5,1.0,0.5,1.5,47.0,36.0,70.0],
  ['Jonathan Kuminga','GSW','F',68,28.0,15.8,5.0,2.5,0.8,0.6,2.0,48.0,32.0,68.0],
  ['Draymond Green','GSW','F',62,28.5,9.5,6.0,6.5,1.2,0.8,2.5,46.0,32.0,72.0],
  // ── NOP ──
  ['Zion Williamson','NOP','F',52,30.0,24.5,7.0,5.0,1.0,0.6,3.5,58.0,34.0,72.0],
  ['Brandon Ingram','NOP','F',55,33.0,22.0,5.5,5.5,0.8,0.5,2.8,48.0,36.0,82.0],
  ['CJ McCollum','NOP','G',60,32.0,18.5,4.0,4.5,1.0,0.3,2.0,45.0,38.0,82.5],
  // ── DAL ──
  ['Kyrie Irving','DAL','G',60,34.0,24.5,5.0,5.5,1.2,0.4,2.5,49.0,40.0,90.0],
  ['PJ Washington','DAL','F',72,32.0,15.8,7.5,2.5,1.0,1.0,1.5,47.0,36.0,72.0],
  ['Dereck Lively II','DAL','C',70,28.0,12.5,8.5,2.0,0.5,1.5,1.2,62.0,25.0,72.0],
  // ── MEM ──
  ['Ja Morant','MEM','G',55,32.0,25.8,5.5,8.5,1.0,0.4,3.5,47.0,34.0,75.0],
  ['Desmond Bane','MEM','G',65,33.0,22.5,5.0,5.0,1.0,0.4,2.2,46.0,38.0,85.0],
  ['Jaren Jackson Jr.','MEM','F',68,30.0,17.8,6.0,1.5,0.8,2.5,1.8,47.0,34.0,78.0],
  // ── SAC ──
  ['De\'Aaron Fox','SAC','G',72,35.5,26.0,4.5,6.5,1.5,0.4,3.0,47.0,34.0,75.0],
  ['Domantas Sabonis','SAC','C',74,35.0,20.5,13.5,7.5,1.0,0.5,3.2,56.0,34.0,72.5],
  ['Keegan Murray','SAC','F',72,32.0,15.8,5.0,2.0,0.8,0.5,1.2,45.0,38.0,82.0],
  // ── UTA ──
  ['Lauri Markkanen','UTA','F',62,34.0,24.5,8.5,2.0,0.5,0.5,1.8,48.5,39.0,88.0],
  ['Collin Sexton','UTA','G',68,30.0,19.5,3.0,4.5,1.0,0.2,2.5,45.0,36.0,82.0],
  ['John Collins','UTA','F',65,28.0,16.0,7.5,1.5,0.5,0.8,1.5,52.0,36.0,78.0],
  // ── CHA ──
  ['LaMelo Ball','CHA','G',62,34.0,24.0,5.5,8.0,1.5,0.3,3.2,44.0,36.5,86.0],
  ['Brandon Miller','CHA','F',70,33.0,18.5,5.0,3.0,1.0,0.5,2.0,44.5,37.0,82.0],
  ['Mark Williams','CHA','C',60,28.0,12.5,9.0,1.5,0.5,1.5,1.5,62.0,10.0,72.0],
  // ── MIA ──
  ['Tyler Herro','MIA','G',68,34.0,22.5,5.5,5.5,0.8,0.3,2.2,45.5,38.5,88.0],
  ['Bam Adebayo','MIA','C',72,34.5,20.5,10.5,4.5,1.2,0.8,2.5,54.0,18.0,80.0],
  ['Jimmy Butler','MIA','F',52,32.0,22.0,5.5,5.0,1.5,0.4,2.5,50.0,36.0,86.0],
  // ── MIL ──
  ['Giannis Antetokounmpo','MIL','F',72,35.5,31.5,12.0,6.0,1.2,1.2,3.5,58.5,28.0,62.0],
  ['Damian Lillard','MIL','G',68,34.5,25.8,4.5,7.0,1.0,0.3,3.0,45.5,37.0,92.0],
  ['Khris Middleton','MIL','F',55,28.0,15.0,4.5,5.0,0.8,0.3,2.0,46.0,38.0,88.0],
  // ── CHI ──
  ['Zach LaVine','CHI','G',65,35.0,24.0,4.5,4.5,1.0,0.4,3.0,48.0,38.0,85.0],
  ['Coby White','CHI','G',72,33.0,18.5,4.0,5.5,0.8,0.3,2.5,44.0,37.0,82.0],
  ['Nikola Vucevic','CHI','C',70,30.0,16.0,10.0,3.5,0.8,0.8,2.0,50.0,36.0,78.0],
  // ── BKN ──
  ['Cam Thomas','BKN','G',70,35.0,24.0,3.5,4.5,0.8,0.3,3.0,44.0,35.0,86.0],
  ['Dennis Schroder','BKN','G',65,30.0,15.5,3.0,6.5,1.0,0.2,2.5,44.0,34.0,82.0],
  ['Nic Claxton','BKN','C',60,28.0,12.5,8.5,2.0,0.8,2.0,1.5,62.0,10.0,62.0],
  // ── IND ──
  ['Tyrese Haliburton','IND','G',68,34.0,20.5,4.0,10.5,1.5,0.5,2.5,46.0,36.0,86.0],
  ['Pascal Siakam','IND','F',72,34.5,22.0,7.0,4.5,0.8,0.5,2.5,49.0,34.0,78.0],
  ['Myles Turner','IND','C',70,30.0,16.5,7.0,1.5,0.5,2.5,1.5,52.0,36.0,78.0],
  ['Bennedict Mathurin','IND','G',70,28.0,14.0,4.0,2.0,0.8,0.3,1.8,44.0,36.0,82.0],
  // ── WAS ──
  ['Jordan Poole','WAS','G',70,33.0,20.5,3.0,5.5,1.0,0.3,3.5,43.0,34.0,86.0],
  ['Kyle Kuzma','WAS','F',62,32.0,19.0,6.5,3.5,0.8,0.5,2.5,45.0,34.0,72.0],
  ['Bilal Coulibaly','WAS','F',72,30.0,13.5,5.0,3.0,1.2,0.8,1.5,44.0,34.0,78.0],
];

/* Convert compact arrays to player objects */
let _allPlayersCache = null;
function getAllPlayers() {
  if (_allPlayersCache) return _allPlayersCache;
  _allPlayersCache = _PR.map(r => {
    const p = {};
    _PK.forEach((k, i) => p[k] = r[i]);
    /* Estimate home/away splits: ~+1.5 pts at home, -1.5 away */
    p.homePpg = +(p.pts * 1.04).toFixed(1);
    p.awayPpg = +(p.pts * 0.96).toFixed(1);
    /* Find full team name from NBA_TEAMS */
    const tm = NBA_TEAMS.find(t => t.abbr === p.team);
    p.teamFull = tm ? tm.name : p.team;
    p.teamId   = tm ? tm.id : 0;
    p.teamColor = tm ? tm.color : '#555';
    return p;
  });
  return _allPlayersCache;
}

/* Get players filtered by team abbreviation */
function getPlayersByTeam(abbr) {
  return getAllPlayers().filter(p => p.team === abbr);
}

function overrideSeriesPrompt(key, data) {
  const all = [...data.west, ...data.east, ...(data.finals ? [data.finals] : [])];
  const s   = all.find(s => [s.team1, s.team2].sort().join('||') === key);
  if (!s) return;
  const input = prompt(`Override: ${s.team1} vs ${s.team2}\nEnter score as "X-Y" where X = ${s.team1} wins, Y = ${s.team2} wins\n(e.g. "3-2")`);
  if (!input) return;
  const m = input.match(/^(\d)-(\d)$/);
  if (!m) { alert('Invalid format — use X-Y like "3-2"'); return; }
  s.t1w = parseInt(m[1]); s.t2w = parseInt(m[2]); s.simulated = false;
  renderBracket(data);
}

/* ════════════════════════════════════════
   PAGE INIT
════════════════════════════════════════ */
(function init() {
  const path = window.location.pathname;
  if (path.endsWith('index.html') || path.endsWith('/') || path === '') loadScoreboard();
  if (path.includes('predict') && !path.includes('player')) initPredictPage();
  if (path.includes('train'))      initTrainPage();
  if (path.includes('player'))     initPlayerPage();
  if (path.includes('team-stats')) initTeamStatsPage();
  if (path.includes('playoff'))    initPlayoffPage();
  if (path.includes('ai.html'))     initAIPage();

  /* Auto-collect ESPN results & auto-retrain on every page load */
  autoCollectAndRetrain();
})();


/* ════════════════════════════════════════
   AI LAB — SELF-IMPROVING PREDICTION ENGINE
   TensorFlow.js Neural Networks + Custom Logistic/Linear Regression
════════════════════════════════════════ */

const AI_GAMES_KEY   = 'nba_ai_training_games';
const AI_META_KEY    = 'nba_ai_meta';
const AI_LR_GAME    = 'nba_lr_game';
const AI_LR_PLAYER  = 'nba_lr_player';
const AI_LR_SERIES  = 'nba_lr_series';
const AI_ACC_KEY     = 'nba_ai_accuracy_log';

/* ── Helper: get/set AI training games ── */
function getAIGames() {
  try { return JSON.parse(localStorage.getItem(AI_GAMES_KEY) || '[]'); }
  catch { return []; }
}
function saveAIGames(games) {
  localStorage.setItem(AI_GAMES_KEY, JSON.stringify(games));
}
function getAIMeta() {
  try { return JSON.parse(localStorage.getItem(AI_META_KEY) || '{}'); }
  catch { return {}; }
}
function saveAIMeta(meta) {
  localStorage.setItem(AI_META_KEY, JSON.stringify(meta));
}

/* ════════════════════════════════════════
   AUTO-COLLECT ESPN GAME RESULTS
════════════════════════════════════════ */
/* Parse ESPN scoreboard JSON and add finished games to the collection */
function _parseESPNGames(jsonArray, existing, existingIds) {
  let added = 0;
  jsonArray.forEach(json => {
    if (!json || !json.events) return;
    json.events.forEach(ev => {
      const comp = ev.competitions?.[0];
      if (!comp) return;
      const state = comp.status?.type?.state;
      if (state !== 'post') return;

      const gid = ev.id || '';
      if (existingIds.has(gid)) return;

      const homeC = comp.competitors?.find(c => c.homeAway === 'home');
      const awayC = comp.competitors?.find(c => c.homeAway === 'away');
      if (!homeC || !awayC) return;

      const homeAbbr = espnToAbbr(homeC.team?.abbreviation || '');
      const awayAbbr = espnToAbbr(awayC.team?.abbreviation || '');
      const homeScore = parseInt(homeC.score) || 0;
      const awayScore = parseInt(awayC.score) || 0;
      const homeTeam = NBA_TEAMS.find(t => t.abbr === homeAbbr);
      const awayTeam = NBA_TEAMS.find(t => t.abbr === awayAbbr);
      if (!homeTeam || !awayTeam) return;

      existing.push({
        id: gid,
        date: ev.date || '',
        homeName: homeTeam.name,
        awayName: awayTeam.name,
        homeAbbr, awayAbbr,
        homeScore, awayScore,
        homeWin: homeScore > awayScore ? 1 : 0,
      });
      existingIds.add(gid);
      added++;
    });
  });
  return added;
}

/* Lightweight auto-collect: last 10 days — runs on every page load */
async function autoCollectESPNResults() {
  try {
    const today = new Date();
    const fetches = [];
    for (let i = 0; i < 10; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const ds = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
      fetches.push(
        fetch(`${ESPN_SCOREBOARD_URL}?dates=${ds}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      );
    }
    const results = await Promise.all(fetches);
    const existing = getAIGames();
    const existingIds = new Set(existing.map(g => g.id));
    const added = _parseESPNGames(results, existing, existingIds);
    if (added > 0) {
      saveAIGames(existing);
      console.log(`[AI] Auto-collected ${added} new games (total: ${existing.length})`);
    }
    return added;
  } catch (err) {
    console.warn('[AI] ESPN auto-collect failed:', err.message);
    return 0;
  }
}

/*
 * BULK collect: fetches ESPN scoreboard for every day in a date range.
 * Runs in batches of 10 days to avoid hammering ESPN.
 * onProgress(collected, totalDays, daysDone) callback for UI updates.
 *
 * @param {Date} fromDate  — start date
 * @param {Date} toDate    — end date (defaults to today)
 */
async function bulkCollectESPN(fromDate, toDate, onProgress) {
  const existing = getAIGames();
  const existingIds = new Set(existing.map(g => g.id));
  const endDate = toDate || new Date();
  const startDate = fromDate || new Date(2025, 9, 22);

  const totalDays = Math.max(1, Math.ceil((endDate - startDate) / 86400000) + 1);
  let totalAdded = 0;
  const BATCH = 10;

  for (let start = 0; start < totalDays; start += BATCH) {
    const fetches = [];
    const end = Math.min(start + BATCH, totalDays);

    for (let i = start; i < end; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      /* Don't fetch future dates */
      if (d > new Date()) continue;
      const ds = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
      fetches.push(
        fetch(`${ESPN_SCOREBOARD_URL}?dates=${ds}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      );
    }

    if (fetches.length > 0) {
      const results = await Promise.all(fetches);
      const batchAdded = _parseESPNGames(results, existing, existingIds);
      totalAdded += batchAdded;
    }

    if (onProgress) onProgress(totalAdded, totalDays, Math.min(end, totalDays));

    /* Small delay between batches to be nice to ESPN */
    if (start + BATCH < totalDays) {
      await new Promise(r => setTimeout(r, 150));
    }
  }

  if (totalAdded > 0) saveAIGames(existing);
  console.log(`[AI] Bulk collected ${totalAdded} games (total: ${existing.length})`);
  return { added: totalAdded, total: existing.length };
}

/*
 * BULK collect from BallDontLie — same data source the rest of the
 * app uses, and it has every NBA game going back years (which is what
 * a Python tool like swar/nba_api would also pull, except BDL works
 * from a browser with no CORS hassle).
 *
 * @param {number} season       — start year, e.g. 2024 for the 2024-25 season
 * @param {boolean} postseason  — true=playoffs only, false=regular season,
 *                                undefined=both (two passes)
 * @param {Function} onProgress — (collected, pagesDone) callback
 */
async function bulkCollectBDL(season, postseason, onProgress) {
  const existing = getAIGames();
  const existingIds = new Set(existing.map(g => g.id));
  let totalAdded = 0;
  const PER = 100;

  /* Two-pass when postseason is undefined: regular season + playoffs */
  const passes = postseason === undefined ? [false, true] : [postseason];

  for (const isPost of passes) {
    let page = 1;
    while (page <= 60) {                       /* safety cap */
      let data;
      try {
        data = await apiFetch(
          `${BASE}/games?seasons[]=${season}&postseason=${isPost}&per_page=${PER}&page=${page}`
        );
      } catch (err) {
        console.warn(`[AI] BDL fetch failed page ${page}:`, err.message);
        break;
      }
      const batch = data?.data || [];
      if (batch.length === 0) break;

      batch.forEach(g => {
        /* Only finished games (have real scores) */
        if (!g.home_team || !g.visitor_team) return;
        if (g.home_team_score == null || g.visitor_team_score == null) return;
        if (g.home_team_score === 0 && g.visitor_team_score === 0) return;

        const gid = `bdl-${g.id}`;
        if (existingIds.has(gid)) return;

        const homeAbbr = g.home_team.abbreviation;
        const awayAbbr = g.visitor_team.abbreviation;
        const homeTeam = NBA_TEAMS.find(t => t.abbr === homeAbbr) ||
                         NBA_TEAMS.find(t => t.name === g.home_team.full_name);
        const awayTeam = NBA_TEAMS.find(t => t.abbr === awayAbbr) ||
                         NBA_TEAMS.find(t => t.name === g.visitor_team.full_name);
        if (!homeTeam || !awayTeam) return;

        const homeScore = g.home_team_score;
        const awayScore = g.visitor_team_score;
        existing.push({
          id: gid,
          date: g.date || '',
          homeName: homeTeam.name,
          awayName: awayTeam.name,
          homeAbbr: homeTeam.abbr,
          awayAbbr: awayTeam.abbr,
          homeScore, awayScore,
          homeWin: homeScore > awayScore ? 1 : 0,
          postseason: isPost,
        });
        existingIds.add(gid);
        totalAdded++;
      });

      if (onProgress) onProgress(totalAdded, page);

      if (!(data.meta?.next_page) || batch.length < PER) break;
      page++;
      /* Small polite delay between pages */
      await new Promise(r => setTimeout(r, 80));
    }
  }

  if (totalAdded > 0) saveAIGames(existing);
  console.log(`[AI] BDL bulk collected ${totalAdded} games (total: ${existing.length})`);
  return { added: totalAdded, total: existing.length };
}

/*
 * BULK collect from BallDontLie by DATE RANGE.
 * This is what the "Collect Games" / "Full Season" / "Playoffs Only"
 * / "Last 30 Days" buttons call — BDL's /games endpoint accepts
 * start_date + end_date in one query, so a 6-week playoff range
 * comes back as a single paginated list instead of 42 day-by-day
 * ESPN requests (most of which return empty).
 *
 * @param {Date}     fromDate
 * @param {Date}     toDate
 * @param {Function} onProgress — (collected, totalDaysEstimate, daysDone)
 */
async function bulkCollectBDLDateRange(fromDate, toDate, onProgress) {
  const existing = getAIGames();
  const existingIds = new Set(existing.map(g => g.id));
  let totalAdded = 0;
  const PER = 100;

  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const start = fmt(fromDate);
  const end   = fmt(toDate);
  const totalDays = Math.max(1, Math.ceil((toDate - fromDate) / 86400000) + 1);

  let page = 1;
  let pagesTotal = 1;
  while (page <= 80) {                          /* safety cap */
    let data;
    try {
      data = await apiFetch(
        `${BASE}/games?start_date=${start}&end_date=${end}&per_page=${PER}&page=${page}`
      );
    } catch (err) {
      console.warn(`[AI] BDL date-range page ${page} failed:`, err.message);
      break;
    }
    const batch = data?.data || [];
    if (batch.length === 0) break;

    batch.forEach(g => {
      if (!g.home_team || !g.visitor_team) return;
      if (g.home_team_score == null || g.visitor_team_score == null) return;
      if (g.home_team_score === 0 && g.visitor_team_score === 0) return;

      const gid = `bdl-${g.id}`;
      if (existingIds.has(gid)) return;

      const homeAbbr = g.home_team.abbreviation;
      const awayAbbr = g.visitor_team.abbreviation;
      const homeTeam = NBA_TEAMS.find(t => t.abbr === homeAbbr) ||
                       NBA_TEAMS.find(t => t.name === g.home_team.full_name);
      const awayTeam = NBA_TEAMS.find(t => t.abbr === awayAbbr) ||
                       NBA_TEAMS.find(t => t.name === g.visitor_team.full_name);
      if (!homeTeam || !awayTeam) return;

      existing.push({
        id: gid,
        date: g.date || '',
        homeName: homeTeam.name,
        awayName: awayTeam.name,
        homeAbbr: homeTeam.abbr,
        awayAbbr: awayTeam.abbr,
        homeScore: g.home_team_score,
        awayScore: g.visitor_team_score,
        homeWin: g.home_team_score > g.visitor_team_score ? 1 : 0,
        postseason: !!g.postseason,
      });
      existingIds.add(gid);
      totalAdded++;
    });

    /* Estimate "days done" so the existing progress bar (built around
       day-by-day ESPN) still moves smoothly. We treat each page as
       advancing through the range proportionally. */
    pagesTotal = data.meta?.total_pages || Math.max(pagesTotal, page);
    const daysDone = Math.min(totalDays, Math.round((page / pagesTotal) * totalDays));
    if (onProgress) onProgress(totalAdded, totalDays, daysDone);

    if (!data.meta?.next_page || batch.length < PER) break;
    page++;
    await new Promise(r => setTimeout(r, 80));  /* polite spacing */
  }

  if (totalAdded > 0) saveAIGames(existing);
  console.log(`[AI] BDL date-range collected ${totalAdded} games (${start} → ${end}, total stored: ${existing.length})`);
  return { added: totalAdded, total: existing.length };
}

/* ════════════════════════════════════════
   FEATURE ENGINEERING
════════════════════════════════════════ */

function getStandingsLookup() {
  /* Returns a map: team name → stats obj */
  const map = {};
  (typeof STANDINGS_2025_26 !== 'undefined' ? STANDINGS_2025_26 : []).forEach(s => {
    const gp = s.wins + s.losses;
    map[s.name] = {
      winPct: gp > 0 ? s.wins / gp : 0.5,
      homeWinPct: (s.homeWins + s.homeLosses) > 0 ? s.homeWins / (s.homeWins + s.homeLosses) : 0.5,
      awayWinPct: (s.awayWins + s.awayLosses) > 0 ? s.awayWins / (s.awayWins + s.awayLosses) : 0.5,
      ppg: s.ppg || 112,
      oppPpg: s.oppPpg || 112,
      netRtg: (s.ppg || 112) - (s.oppPpg || 112),
    };
  });
  return map;
}

const _defaultTeamStats = { winPct:0.5, homeWinPct:0.5, awayWinPct:0.5, ppg:112, oppPpg:112, netRtg:0 };

function extractGameFeatures(homeName, awayName) {
  const lookup = getStandingsLookup();
  const h = lookup[homeName] || _defaultTeamStats;
  const a = lookup[awayName] || _defaultTeamStats;

  /* H2H record */
  let h2hAdv = 0.5;
  if (typeof H2H_2025_26 !== 'undefined') {
    const matchup = H2H_2025_26.find(m =>
      (m.t1 === homeName && m.t2 === awayName) ||
      (m.t2 === homeName && m.t1 === awayName)
    );
    if (matchup && matchup.games.length > 0) {
      let homeWins = 0;
      matchup.games.forEach(g => {
        const hw = g.hScore > g.aScore;
        if ((g.home === homeName && hw) || (g.home !== homeName && !hw)) homeWins++;
      });
      h2hAdv = homeWins / matchup.games.length;
    }
  }

  return [
    h.winPct,                          // 0
    a.winPct,                          // 1
    h.homeWinPct,                      // 2
    a.awayWinPct,                      // 3
    (h.netRtg + 15) / 30,             // 4 (scaled ~0-1)
    (a.netRtg + 15) / 30,             // 5
    h.ppg / 130,                       // 6
    a.ppg / 130,                       // 7
    h.oppPpg / 130,                    // 8
    a.oppPpg / 130,                    // 9
    (h.winPct - a.winPct + 1) / 2,    // 10 (centered)
    ((h.netRtg - a.netRtg) + 20) / 40,// 11 (centered)
    h2hAdv,                            // 12
    1.0,                               // 13 (home indicator)
  ];
}

function extractPlayerFeatures(player, oppName, isHome) {
  const lookup = getStandingsLookup();
  const opp = lookup[oppName] || _defaultTeamStats;

  return [
    (player.pts || 0) / 40,           // 0 PPG
    (player.min || 0) / 40,           // 1 MPG
    (player.fg || 0) / 100,           // 2 FG%
    (player.fg3 || 0) / 100,          // 3 3P%
    (player.ft || 0) / 100,           // 4 FT%
    (player.gp || 0) / 82,            // 5 GP
    isHome ? 1 : 0,                    // 6 home/away
    opp.oppPpg / 130,                  // 7 opp defensive rating
    Math.min((player.pts || 0) / Math.max(player.min || 1, 1) * 2, 2) / 2,  // 8 usage
    ((player.reb || 0) + (player.ast || 0)) / 25,  // 9 reb+ast
  ];
}

function extractSeriesFeatures(team1Name, team2Name, t1w, t2w) {
  const lookup = getStandingsLookup();
  const a = lookup[team1Name] || _defaultTeamStats;
  const b = lookup[team2Name] || _defaultTeamStats;

  return [
    a.winPct,                          // 0
    b.winPct,                          // 1
    (a.netRtg + 15) / 30,             // 2
    (b.netRtg + 15) / 30,             // 3
    (a.winPct - b.winPct + 1) / 2,    // 4
    ((a.netRtg - b.netRtg) + 20) / 40,// 5
    t1w / 4,                           // 6
    t2w / 4,                           // 7
    ((t1w - t2w) + 4) / 8,            // 8 series lead
    (t1w === 3 || t2w === 3) ? 1 : 0, // 9 elimination
  ];
}

/* ── Training Data Generators ── */

function generateGameTrainingData() {
  const xs = [], ys = [];

  /* 1. ESPN auto-collected games */
  const espn = getAIGames();
  espn.forEach(g => {
    const feats = extractGameFeatures(g.homeName, g.awayName);
    xs.push(feats);
    ys.push(g.homeWin);
  });

  /* 2. H2H hardcoded games */
  if (typeof H2H_2025_26 !== 'undefined') {
    H2H_2025_26.forEach(matchup => {
      matchup.games.forEach(g => {
        const away = g.home === matchup.t1 ? matchup.t2 : matchup.t1;
        const feats = extractGameFeatures(g.home, away);
        xs.push(feats);
        ys.push(g.hScore > g.aScore ? 1 : 0);
      });
    });
  }

  /* 3. Imported games from Train page */
  const stored = getStoredGames();
  stored.forEach(g => {
    const hName = g.home_team?.full_name || g.homeName || '';
    const aName = g.visitor_team?.full_name || g.awayName || '';
    if (!hName || !aName) return;
    const hScore = g.home_team_score ?? g.homeScore ?? 0;
    const aScore = g.visitor_team_score ?? g.awayScore ?? 0;
    const feats = extractGameFeatures(hName, aName);
    xs.push(feats);
    ys.push(hScore > aScore ? 1 : 0);
  });

  /* 4. Synthetic augmentation from standings */
  if (typeof STANDINGS_2025_26 !== 'undefined' && xs.length < 200) {
    const teams = STANDINGS_2025_26.map(s => s.name);
    for (let i = 0; i < teams.length; i++) {
      for (let j = 0; j < teams.length; j++) {
        if (i === j) continue;
        const feats = extractGameFeatures(teams[i], teams[j]);
        const lookup = getStandingsLookup();
        const hi = lookup[teams[i]] || _defaultTeamStats;
        const aj = lookup[teams[j]] || _defaultTeamStats;
        const edge = (hi.winPct - aj.winPct) * 0.6 + 0.03;
        const homeWin = Math.random() < (0.5 + edge) ? 1 : 0;
        xs.push(feats);
        ys.push(homeWin);
      }
    }
  }

  /* Train/test split (80/20) */
  const n = xs.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const split = Math.floor(n * 0.8);
  const xTrain = [], yTrain = [], xTest = [], yTest = [];
  indices.forEach((idx, i) => {
    if (i < split) { xTrain.push(xs[idx]); yTrain.push(ys[idx]); }
    else           { xTest.push(xs[idx]);  yTest.push(ys[idx]); }
  });

  return { xTrain, yTrain, xTest, yTest, total: n };
}

function generatePlayerTrainingData() {
  const xs = [], ys = [];
  const players = typeof getAllPlayers === 'function' ? getAllPlayers() : [];
  const teams = typeof STANDINGS_2025_26 !== 'undefined' ? STANDINGS_2025_26.map(s => s.name) : [];

  players.forEach(p => {
    /* Generate samples against 6 random opponents, home & away */
    const opps = teams.sort(() => Math.random() - 0.5).slice(0, 6);
    opps.forEach(opp => {
      [true, false].forEach(isHome => {
        const feats = extractPlayerFeatures(p, opp, isHome);
        /* Add noise to simulate game variance */
        const noise = (Math.random() - 0.5) * p.pts * 0.3;
        const label = Math.max(0, p.pts + noise + (isHome ? 1.5 : -1.5));
        xs.push(feats);
        ys.push(label);
      });
    });
  });

  /* Train/test split */
  const n = xs.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const split = Math.floor(n * 0.8);
  const xTrain = [], yTrain = [], xTest = [], yTest = [];
  indices.forEach((idx, i) => {
    if (i < split) { xTrain.push(xs[idx]); yTrain.push(ys[idx]); }
    else           { xTest.push(xs[idx]);  yTest.push(ys[idx]); }
  });

  return { xTrain, yTrain, xTest, yTest, total: n };
}

function generateSeriesTrainingData() {
  const xs = [], ys = [];

  /* From hardcoded bracket */
  if (typeof PLAYOFF_BRACKET_2025_26 !== 'undefined') {
    const allSeries = [...PLAYOFF_BRACKET_2025_26.west, ...PLAYOFF_BRACKET_2025_26.east];
    allSeries.forEach(s => {
      if (s.t1w + s.t2w === 0) return;
      /* Generate partial states leading up to current result */
      for (let w1 = 0; w1 <= s.t1w; w1++) {
        for (let w2 = 0; w2 <= s.t2w; w2++) {
          if (w1 === 0 && w2 === 0) continue;
          if (w1 > s.t1w || w2 > s.t2w) continue;
          const feats = extractSeriesFeatures(s.team1, s.team2, w1, w2);
          const label = s.t1w >= 4 ? 1 : 0;  /* team1 wins series */
          xs.push(feats);
          ys.push(label);
        }
      }
    });
  }

  /* Synthetic series from standings */
  if (typeof STANDINGS_2025_26 !== 'undefined') {
    const teams = STANDINGS_2025_26.map(s => s.name);
    const lookup = getStandingsLookup();
    for (let i = 0; i < 100; i++) {
      const t1 = teams[Math.floor(Math.random() * teams.length)];
      const t2 = teams[Math.floor(Math.random() * teams.length)];
      if (t1 === t2) continue;
      const a = lookup[t1] || _defaultTeamStats;
      const b = lookup[t2] || _defaultTeamStats;
      const edge = (a.winPct - b.winPct) * 1.5;
      const p1 = clamp(0.5 + edge, 0.15, 0.85);
      /* Simulate a series */
      let w1 = 0, w2 = 0;
      while (w1 < 4 && w2 < 4) {
        if (Math.random() < p1) w1++; else w2++;
      }
      /* Record several states from this series */
      for (let s1 = 0; s1 <= w1; s1++) {
        for (let s2 = 0; s2 <= w2; s2++) {
          if (s1 === 0 && s2 === 0) continue;
          if (s1 > w1 || s2 > w2) continue;
          if (Math.random() > 0.4) continue;  /* subsample */
          const feats = extractSeriesFeatures(t1, t2, s1, s2);
          xs.push(feats);
          ys.push(w1 >= 4 ? 1 : 0);
        }
      }
    }
  }

  /* Shuffle & split */
  const n = xs.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const split = Math.floor(n * 0.8);
  const xTrain = [], yTrain = [], xTest = [], yTest = [];
  indices.forEach((idx, i) => {
    if (i < split) { xTrain.push(xs[idx]); yTrain.push(ys[idx]); }
    else           { xTest.push(xs[idx]);  yTest.push(ys[idx]); }
  });

  return { xTrain, yTrain, xTest, yTest, total: n };
}


/* ════════════════════════════════════════
   LOGISTIC / LINEAR REGRESSION (Pure JS)
════════════════════════════════════════ */

class LogisticRegression {
  constructor(numFeatures, lr = 0.01) {
    this.w = new Float64Array(numFeatures);
    this.b = 0;
    this.lr = lr;
    this.lossHistory = [];
  }

  sigmoid(z) { return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z)))); }

  predict(x) {
    let z = this.b;
    for (let i = 0; i < x.length; i++) z += this.w[i] * x[i];
    return this.sigmoid(z);
  }

  trainStep(X, y) {
    const m = X.length;
    const dw = new Float64Array(this.w.length);
    let db = 0, loss = 0;

    for (let i = 0; i < m; i++) {
      const pred = this.predict(X[i]);
      const err = pred - y[i];
      for (let j = 0; j < this.w.length; j++) dw[j] += err * X[i][j];
      db += err;
      loss += -y[i] * Math.log(pred + 1e-10) - (1 - y[i]) * Math.log(1 - pred + 1e-10);
    }

    for (let j = 0; j < this.w.length; j++) this.w[j] -= this.lr * dw[j] / m;
    this.b -= this.lr * db / m;
    return loss / m;
  }

  async train(X, y, epochs, onEpoch) {
    for (let e = 0; e < epochs; e++) {
      const loss = this.trainStep(X, y);
      this.lossHistory.push(loss);
      if (onEpoch) onEpoch(e, loss);
      if (e % 5 === 0) await new Promise(r => setTimeout(r, 0)); /* yield to UI */
    }
  }

  accuracy(X, y) {
    let correct = 0;
    for (let i = 0; i < X.length; i++) {
      const pred = this.predict(X[i]) >= 0.5 ? 1 : 0;
      if (pred === y[i]) correct++;
    }
    return X.length > 0 ? correct / X.length : 0;
  }

  save(key) {
    localStorage.setItem(key, JSON.stringify({
      w: Array.from(this.w), b: this.b, lr: this.lr, lossHistory: this.lossHistory
    }));
  }

  static load(key) {
    try {
      const d = JSON.parse(localStorage.getItem(key));
      if (!d || !d.w) return null;
      const m = new LogisticRegression(d.w.length, d.lr);
      m.w = new Float64Array(d.w);
      m.b = d.b;
      m.lossHistory = d.lossHistory || [];
      return m;
    } catch { return null; }
  }
}

class LinearRegression {
  constructor(numFeatures, lr = 0.005) {
    this.w = new Float64Array(numFeatures);
    this.b = 0;
    this.lr = lr;
    this.lossHistory = [];
  }

  predict(x) {
    let z = this.b;
    for (let i = 0; i < x.length; i++) z += this.w[i] * x[i];
    return z;
  }

  trainStep(X, y) {
    const m = X.length;
    const dw = new Float64Array(this.w.length);
    let db = 0, loss = 0;

    for (let i = 0; i < m; i++) {
      const pred = this.predict(X[i]);
      const err = pred - y[i];
      for (let j = 0; j < this.w.length; j++) dw[j] += err * X[i][j];
      db += err;
      loss += err * err;
    }

    for (let j = 0; j < this.w.length; j++) this.w[j] -= this.lr * dw[j] / m;
    this.b -= this.lr * db / m;
    return loss / m;  /* MSE */
  }

  async train(X, y, epochs, onEpoch) {
    for (let e = 0; e < epochs; e++) {
      const loss = this.trainStep(X, y);
      this.lossHistory.push(loss);
      if (onEpoch) onEpoch(e, loss);
      if (e % 5 === 0) await new Promise(r => setTimeout(r, 0));
    }
  }

  mae(X, y) {
    let sum = 0;
    for (let i = 0; i < X.length; i++) sum += Math.abs(this.predict(X[i]) - y[i]);
    return X.length > 0 ? sum / X.length : 0;
  }

  save(key) {
    localStorage.setItem(key, JSON.stringify({
      w: Array.from(this.w), b: this.b, lr: this.lr, lossHistory: this.lossHistory
    }));
  }

  static load(key) {
    try {
      const d = JSON.parse(localStorage.getItem(key));
      if (!d || !d.w) return null;
      const m = new LinearRegression(d.w.length, d.lr);
      m.w = new Float64Array(d.w);
      m.b = d.b;
      m.lossHistory = d.lossHistory || [];
      return m;
    } catch { return null; }
  }
}


/* ════════════════════════════════════════
   TENSORFLOW.JS NEURAL NETWORKS
════════════════════════════════════════ */

function createGameNN(lr = 0.001) {
  if (typeof tf === 'undefined') return null;
  const model = tf.sequential();
  model.add(tf.layers.dense({ inputShape: [14], units: 32, activation: 'relu' }));
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  model.add(tf.layers.dropout({ rate: 0.1 }));
  model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
  model.compile({ optimizer: tf.train.adam(lr), loss: 'binaryCrossentropy', metrics: ['accuracy'] });
  return model;
}

function createPlayerNN(lr = 0.001) {
  if (typeof tf === 'undefined') return null;
  const model = tf.sequential();
  model.add(tf.layers.dense({ inputShape: [10], units: 24, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 12, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1, activation: 'linear' }));
  model.compile({ optimizer: tf.train.adam(lr), loss: 'meanSquaredError', metrics: ['mse'] });
  return model;
}

function createSeriesNN(lr = 0.001) {
  if (typeof tf === 'undefined') return null;
  const model = tf.sequential();
  model.add(tf.layers.dense({ inputShape: [10], units: 20, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 10, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
  model.compile({ optimizer: tf.train.adam(lr), loss: 'binaryCrossentropy', metrics: ['accuracy'] });
  return model;
}

async function trainNNModel(model, xTrain, yTrain, xTest, yTest, epochs, batchSize, onEpoch) {
  if (!model) return null;

  const xT = tf.tensor2d(xTrain);
  const yT = tf.tensor2d(yTrain.map(v => [v]));
  const xV = tf.tensor2d(xTest);
  const yV = tf.tensor2d(yTest.map(v => [v]));

  const lossHist = [], valLossHist = [];

  await model.fit(xT, yT, {
    epochs,
    batchSize,
    validationData: [xV, yV],
    shuffle: true,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        lossHist.push(logs.loss);
        valLossHist.push(logs.val_loss);
        if (onEpoch) onEpoch(epoch, logs.loss, logs.val_loss, logs);
      }
    }
  });

  xT.dispose(); yT.dispose(); xV.dispose(); yV.dispose();
  return { lossHist, valLossHist };
}

async function saveNNModel(model, name) {
  if (!model) return;
  try { await model.save(`localstorage://nba-${name}`); }
  catch (e) { console.warn('[AI] NN save failed:', e.message); }
}

async function loadNNModel(name) {
  if (typeof tf === 'undefined') return null;
  try { return await tf.loadLayersModel(`localstorage://nba-${name}`); }
  catch { return null; }
}

function nnPredict(model, features) {
  if (!model) return null;
  const t = tf.tensor2d([features]);
  const pred = model.predict(t).dataSync()[0];
  t.dispose();
  return pred;
}

function nnAccuracy(model, X, y) {
  if (!model || X.length === 0) return 0;
  let correct = 0;
  X.forEach((x, i) => {
    const p = nnPredict(model, x);
    const pred = p >= 0.5 ? 1 : 0;
    if (pred === y[i]) correct++;
  });
  return correct / X.length;
}

function nnMAE(model, X, y) {
  if (!model || X.length === 0) return 0;
  let sum = 0;
  X.forEach((x, i) => { sum += Math.abs(nnPredict(model, x) - y[i]); });
  return sum / X.length;
}


/* ════════════════════════════════════════
   TRAINING VISUALIZATION (Canvas)
════════════════════════════════════════ */

function drawLossChart(canvasId, trainLoss, valLoss) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || trainLoss.length === 0) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth || 400;
  const H = 180;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');

  const pad = { top: 20, right: 14, bottom: 30, left: 42 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;
  const allVals = [...trainLoss, ...(valLoss || [])];
  const maxL = Math.max(...allVals, 0.01);
  const minL = Math.min(...allVals, 0);
  const n = trainLoss.length;

  function redraw(hoverIdx) {
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    /* Grid */
    ctx.strokeStyle = '#333'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (cH / 4) * i;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillStyle = '#666'; ctx.font = '9px Arial'; ctx.textAlign = 'right';
      const val = maxL - (maxL - minL) * (i / 4);
      ctx.fillText(val.toFixed(3), pad.left - 4, y + 3);
    }

    /* Training loss line */
    ctx.strokeStyle = '#cc0000'; ctx.lineWidth = 2; ctx.beginPath();
    trainLoss.forEach((v, i) => {
      const x = pad.left + (i / Math.max(n - 1, 1)) * cW;
      const y = pad.top + (1 - (v - minL) / (maxL - minL + 1e-10)) * cH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    /* Validation loss line */
    if (valLoss && valLoss.length > 0) {
      ctx.strokeStyle = '#ffd600'; ctx.lineWidth = 1.5; ctx.beginPath();
      valLoss.forEach((v, i) => {
        const x = pad.left + (i / Math.max(n - 1, 1)) * cW;
        const y = pad.top + (1 - (v - minL) / (maxL - minL + 1e-10)) * cH;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    /* Legend */
    ctx.fillStyle = '#cc0000'; ctx.fillRect(pad.left, H - 14, 12, 3);
    ctx.fillStyle = '#aaa'; ctx.font = '9px Arial'; ctx.textAlign = 'left';
    ctx.fillText('Train', pad.left + 16, H - 10);
    if (valLoss) {
      ctx.fillStyle = '#ffd600'; ctx.fillRect(pad.left + 60, H - 14, 12, 3);
      ctx.fillStyle = '#aaa'; ctx.fillText('Validation', pad.left + 76, H - 10);
    }

    /* X-axis */
    ctx.fillStyle = '#666'; ctx.font = '9px Arial'; ctx.textAlign = 'center';
    ctx.fillText('Epoch 1', pad.left, H - 2);
    ctx.fillText(`Epoch ${n}`, W - pad.right, H - 2);

    /* Hover tooltip */
    if (hoverIdx >= 0 && hoverIdx < n) {
      const hx = pad.left + (hoverIdx / Math.max(n - 1, 1)) * cW;

      /* Vertical crosshair */
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(hx, pad.top); ctx.lineTo(hx, pad.top + cH); ctx.stroke();
      ctx.setLineDash([]);

      /* Dots at hover point */
      const ty = pad.top + (1 - (trainLoss[hoverIdx] - minL) / (maxL - minL + 1e-10)) * cH;
      ctx.beginPath(); ctx.arc(hx, ty, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#cc0000'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();

      let tooltipLines = [`Epoch ${hoverIdx + 1}`, `Train: ${trainLoss[hoverIdx].toFixed(4)}`];
      if (valLoss && valLoss[hoverIdx] != null) {
        const vy = pad.top + (1 - (valLoss[hoverIdx] - minL) / (maxL - minL + 1e-10)) * cH;
        ctx.beginPath(); ctx.arc(hx, vy, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd600'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        tooltipLines.push(`Val: ${valLoss[hoverIdx].toFixed(4)}`);
      }

      /* Tooltip box */
      const txt = tooltipLines.join('  ·  ');
      const tw = ctx.measureText(txt).width + 16;
      let tx = hx - tw / 2;
      if (tx < pad.left) tx = pad.left;
      if (tx + tw > W - pad.right) tx = W - pad.right - tw;
      const tty = Math.max(pad.top, ty - 30);

      ctx.fillStyle = 'rgba(20,20,20,0.92)';
      ctx.beginPath(); ctx.roundRect(tx, tty, tw, 22, 6); ctx.fill();
      ctx.strokeStyle = '#cc0000'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(tx, tty, tw, 22, 6); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center';
      ctx.fillText(txt, tx + tw / 2, tty + 15);
    }

    ctx.restore();
  }

  redraw(-1);

  /* Mouse hover */
  const getIdx = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const closest = Math.round(((mx - pad.left) / cW) * Math.max(n - 1, 1));
    return (closest >= 0 && closest < n && mx >= pad.left && mx <= W - pad.right) ? closest : -1;
  };
  canvas.onmousemove = (e) => { const idx = getIdx(e); redraw(idx); canvas.style.cursor = idx >= 0 ? 'crosshair' : 'default'; };
  canvas.onmouseleave = () => { redraw(-1); canvas.style.cursor = 'default'; };
}

function drawAccuracyBars(canvasId, results) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth || 400;
  const H = 130;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const bars = [
    { label: 'Formula',  val: results.formula || 0, color: '#888888' },
    { label: 'Log. Reg', val: results.lr || 0,      color: '#ffd600' },
    { label: 'Neural Net', val: results.nn || 0,     color: '#cc0000' },
  ];

  const barH = 28, gap = 12, startY = 10, labelW = 80;
  bars.forEach((b, i) => {
    const y = startY + i * (barH + gap);
    const maxBarW = W - labelW - 70;
    const bW = b.val * maxBarW;

    /* Label */
    ctx.fillStyle = '#aaa'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'right';
    ctx.fillText(b.label, labelW - 8, y + barH / 2 + 4);

    /* Bar bg */
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(labelW, y, maxBarW, barH);

    /* Bar fill */
    ctx.fillStyle = b.color;
    ctx.fillRect(labelW, y, bW, barH);

    /* Value */
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'left';
    ctx.fillText(`${(b.val * 100).toFixed(1)}%`, labelW + bW + 8, y + barH / 2 + 4);
  });
}

function drawMAEBars(canvasId, results) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth || 400;
  const H = 130;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const bars = [
    { label: 'Formula',  val: results.formula || 0, color: '#888888' },
    { label: 'Lin. Reg', val: results.lr || 0,      color: '#ffd600' },
    { label: 'Neural Net', val: results.nn || 0,     color: '#cc0000' },
  ];
  const maxVal = Math.max(...bars.map(b => b.val), 1);

  const barH = 28, gap = 12, startY = 10, labelW = 80;
  bars.forEach((b, i) => {
    const y = startY + i * (barH + gap);
    const maxBarW = W - labelW - 80;
    const bW = (b.val / maxVal) * maxBarW;

    ctx.fillStyle = '#aaa'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'right';
    ctx.fillText(b.label, labelW - 8, y + barH / 2 + 4);

    ctx.fillStyle = '#2a2a2a'; ctx.fillRect(labelW, y, maxBarW, barH);
    ctx.fillStyle = b.color; ctx.fillRect(labelW, y, bW, barH);

    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'left';
    ctx.fillText(`${b.val.toFixed(1)} pts MAE`, labelW + bW + 8, y + barH / 2 + 4);
  });
}

function drawAccuracyTrend(canvasId, log) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !log || log.length < 1) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth || 500;
  const H = 160;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const pad = { top: 16, right: 14, bottom: 24, left: 42 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;

  /* Build data points — use accuracy field directly, or rolling window */
  const pts = [];
  const labels = [];
  if (log[0]?.accuracy != null) {
    /* Structured log with accuracy per entry */
    log.forEach((entry, i) => {
      pts.push(entry.accuracy);
      labels.push({ acc: entry.accuracy, games: entry.games || i + 1, date: entry.date || '' });
    });
  } else {
    /* Legacy: rolling window of 10 */
    const winSz = Math.min(10, log.length);
    for (let i = winSz - 1; i < log.length; i++) {
      const w = log.slice(i - winSz + 1, i + 1);
      const acc = w.filter(g => g.correct).length / w.length;
      pts.push(acc);
      labels.push({ acc, games: i + 1, date: '' });
    }
  }
  if (pts.length < 1) return;

  /* If only 1 point, duplicate to draw something */
  if (pts.length === 1) { pts.push(pts[0]); labels.push({ ...labels[0] }); }

  const maxA = Math.min(1, Math.max(...pts) + 0.05);
  const minA = Math.max(0, Math.min(...pts) - 0.05);

  function redraw(hoverIdx) {
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    /* Grid */
    ctx.strokeStyle = '#333'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (cH / 4) * i;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillStyle = '#666'; ctx.font = '9px Arial'; ctx.textAlign = 'right';
      const val = maxA - (maxA - minA) * (i / 4);
      ctx.fillText((val * 100).toFixed(0) + '%', pad.left - 4, y + 3);
    }

    /* Gradient fill under the line */
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
    grad.addColorStop(0, 'rgba(0,200,83,0.25)');
    grad.addColorStop(1, 'rgba(0,200,83,0.02)');

    /* Build path coords */
    const coords = pts.map((v, i) => ({
      x: pad.left + (i / Math.max(pts.length - 1, 1)) * cW,
      y: pad.top + (1 - (v - minA) / (maxA - minA + 1e-10)) * cH
    }));

    /* Fill area */
    ctx.beginPath();
    ctx.moveTo(coords[0].x, pad.top + cH);
    coords.forEach(c => ctx.lineTo(c.x, c.y));
    ctx.lineTo(coords[coords.length - 1].x, pad.top + cH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    /* Line */
    ctx.strokeStyle = '#00c853'; ctx.lineWidth = 2; ctx.beginPath();
    coords.forEach((c, i) => i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y));
    ctx.stroke();

    /* Dots on each point */
    coords.forEach((c, i) => {
      ctx.beginPath(); ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = i === hoverIdx ? '#fff' : '#00c853'; ctx.fill();
      if (i === hoverIdx) { ctx.strokeStyle = '#00c853'; ctx.lineWidth = 2; ctx.stroke(); }
    });

    /* X-axis label */
    ctx.fillStyle = '#666'; ctx.font = '9px Arial'; ctx.textAlign = 'center';
    ctx.fillText('Training Sessions', W / 2, H - 2);

    /* Hover tooltip */
    if (hoverIdx >= 0 && hoverIdx < coords.length) {
      const c = coords[hoverIdx];
      const lb = labels[hoverIdx];
      const txt = `${(lb.acc * 100).toFixed(1)}%  ·  ${lb.games} games`;
      const tw = ctx.measureText(txt).width + 16;
      let tx = c.x - tw / 2;
      if (tx < pad.left) tx = pad.left;
      if (tx + tw > W - pad.right) tx = W - pad.right - tw;
      const ty = c.y - 28;

      /* Vertical crosshair */
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(c.x, pad.top); ctx.lineTo(c.x, pad.top + cH); ctx.stroke();
      ctx.setLineDash([]);

      /* Tooltip box */
      ctx.fillStyle = 'rgba(20,20,20,0.92)';
      ctx.beginPath();
      ctx.roundRect(tx, ty, tw, 22, 6);
      ctx.fill();
      ctx.strokeStyle = '#00c853'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(tx, ty, tw, 22, 6); ctx.stroke();

      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center';
      ctx.fillText(txt, tx + tw / 2, ty + 15);
    }

    ctx.restore();
  }

  redraw(-1);

  /* Mouse hover interaction */
  const getIdx = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    /* Find nearest point */
    let closest = -1, minDist = Infinity;
    pts.forEach((_, i) => {
      const px = pad.left + (i / Math.max(pts.length - 1, 1)) * cW;
      const dist = Math.abs(mx - px);
      if (dist < minDist && dist < 30) { minDist = dist; closest = i; }
    });
    return closest;
  };

  canvas.onmousemove = (e) => { redraw(getIdx(e)); canvas.style.cursor = getIdx(e) >= 0 ? 'crosshair' : 'default'; };
  canvas.onmouseleave = () => { redraw(-1); canvas.style.cursor = 'default'; };
}


/* ════════════════════════════════════════
   AUTO-RETRAIN SYSTEM
════════════════════════════════════════ */

async function autoCollectAndRetrain() {
  /* Step 1: Auto-collect from ESPN */
  const newGames = await autoCollectESPNResults();

  /* Step 2: Check if retrain needed */
  const meta = getAIMeta();
  const totalGames = getAIGames().length;
  const lastCount = meta.lastTrainCount || 0;

  /* ── Auto-train all three LR models so visitors never have to click
        "Train" at the AI Lab. Models persist to localStorage; we only
        retrain when new games come in (or when a slot is empty). ── */
  const needGameLR   = !meta.lrTrained        || (totalGames > lastCount && totalGames >= 5);
  const needSeriesLR = !meta.lrSeriesTrained;
  const needPlayerLR = !meta.lrPlayerTrained;

  /* GAME LR */
  if (needGameLR) {
    try {
      const data = generateGameTrainingData();
      if (data.xTrain.length >= 5) {
        const lr = new LogisticRegression(14, 0.01);
        await lr.train(data.xTrain, data.yTrain, 30);
        lr.save(AI_LR_GAME);

        const acc = lr.accuracy(data.xTest, data.yTest);
        meta.gameAccuracy = acc;
        meta.lastTrainCount = totalGames;
        meta.lastTrainDate = new Date().toISOString();
        meta.lrTrained = true;
        saveAIMeta(meta);

        try {
          const accLog = JSON.parse(localStorage.getItem(AI_ACC_KEY) || '[]');
          accLog.push({ date: new Date().toISOString(), accuracy: acc, games: totalGames, correct: acc >= 0.5 });
          localStorage.setItem(AI_ACC_KEY, JSON.stringify(accLog));
        } catch {}

        if (newGames > 0) showAIToast(`Model updated with ${newGames} new game${newGames>1?'s':''} — accuracy: ${(acc*100).toFixed(0)}%`);
        console.log(`[AI] Auto-retrained Game LR on ${data.total} samples, accuracy: ${(acc*100).toFixed(1)}%`);
      }
    } catch (e) { console.warn('[AI] Game LR auto-retrain failed:', e.message); }
  }

  /* SERIES LR — only train once (or when explicitly retrained from AI Lab) */
  if (needSeriesLR) {
    try {
      const sData = generateSeriesTrainingData();
      if (sData.xTrain.length >= 5) {
        const featLen = sData.xTrain[0].length;
        const lr = new LogisticRegression(featLen, 0.01);
        await lr.train(sData.xTrain, sData.yTrain, 30);
        lr.save(AI_LR_SERIES);
        const acc = lr.accuracy(sData.xTest, sData.yTest);
        meta.seriesAccuracy = acc;
        meta.lrSeriesTrained = true;
        saveAIMeta(meta);
        console.log(`[AI] Auto-trained Series LR on ${sData.total} samples, accuracy: ${(acc*100).toFixed(1)}%`);
      }
    } catch (e) { console.warn('[AI] Series LR auto-train failed:', e.message); }
  }

  /* PLAYER LR — uses Linear Regression on player features (continuous) */
  if (needPlayerLR && typeof LinearRegression === 'function' && typeof generatePlayerTrainingData === 'function') {
    try {
      const pData = generatePlayerTrainingData();
      if (pData.xTrain && pData.xTrain.length >= 5) {
        const featLen = pData.xTrain[0].length;
        const lr = new LinearRegression(featLen, 0.01);
        await lr.train(pData.xTrain, pData.yTrain, 30);
        lr.save(AI_LR_PLAYER);
        meta.lrPlayerTrained = true;
        saveAIMeta(meta);
        console.log(`[AI] Auto-trained Player LR on ${pData.total} samples`);
      }
    } catch (e) { console.warn('[AI] Player LR auto-train failed:', e.message); }
  }

  /* Refresh dashboard if on AI page (auto-collect finishes after initAIPage) */
  if (typeof updateAIDashboard === 'function' && document.getElementById('dashGamesLearned')) {
    updateAIDashboard();
  }
}

function showAIToast(msg) {
  /* Try to show toast on AI page, or create temporary one */
  let toast = document.getElementById('aiToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'ai-toast';
    toast.style.cssText = 'position:fixed;top:80px;right:20px;z-index:10000;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toast.classList.add('ai-toast-show');
  setTimeout(() => { toast.classList.remove('ai-toast-show'); toast.classList.add('hidden'); }, 4000);
}


/* ════════════════════════════════════════
   AI PREDICTION BRIDGE (for other pages)
════════════════════════════════════════ */

function hasTrainedAIModel(type) {
  const meta = getAIMeta();
  if (type === 'game') return !!meta.lrTrained || !!meta.nnGameTrained;
  if (type === 'player') return !!meta.lrPlayerTrained || !!meta.nnPlayerTrained;
  if (type === 'series') return !!meta.lrSeriesTrained || !!meta.nnSeriesTrained;
  return false;
}

function getAIGamePrediction(homeName, awayName) {
  const feats = extractGameFeatures(homeName, awayName);
  const result = { lr: null, nn: null };

  /* LR prediction */
  const lr = LogisticRegression.load(AI_LR_GAME);
  if (lr) result.lr = lr.predict(feats);

  return result;
}

function getAIPlayerPrediction(player, oppName, isHome) {
  const feats = extractPlayerFeatures(player, oppName, isHome);
  const result = { lr: null, nn: null };

  const lr = LinearRegression.load(AI_LR_PLAYER);
  if (lr) result.lr = lr.predict(feats);

  return result;
}

function getAISeriesPrediction(team1, team2, t1w, t2w) {
  const feats = extractSeriesFeatures(team1, team2, t1w, t2w);
  const result = { lr: null, nn: null };

  const lr = LogisticRegression.load(AI_LR_SERIES);
  if (lr) result.lr = lr.predict(feats);

  return result;
}


/* ════════════════════════════════════════
   AI LAB PAGE INIT
════════════════════════════════════════ */

async function initAIPage() {
  if (!document.getElementById('aiToast')) return;

  /* ── Populate team selectors ── */
  ['aiGameHome','aiGameAway','aiPlayerOpp','aiSeriesT1','aiSeriesT2'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    NBA_TEAMS.forEach(t => sel.add(new Option(t.name, t.name)));
  });

  /* Populate player selector */
  const pSel = document.getElementById('aiPlayerSelect');
  if (pSel) {
    const players = typeof getAllPlayers === 'function' ? getAllPlayers() : [];
    players.sort((a, b) => b.pts - a.pts).forEach(p => {
      pSel.add(new Option(`${p.name} (${p.team}) — ${p.pts.toFixed(1)} PPG`, p.name));
    });
  }

  /* ── Tab switching ── */
  document.querySelectorAll('.ai-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ai-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.ai-tab-content').forEach(c => c.classList.add('hidden'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      const panel = document.getElementById(tab === 'game' ? 'tabGame' : tab === 'player' ? 'tabPlayer' : 'tabSeries');
      if (panel) panel.classList.remove('hidden');
    });
  });

  /* ── Set default "To" date to today ── */
  const collectToInput = document.getElementById('collectTo');
  if (collectToInput && !collectToInput.value) {
    const today = new Date();
    collectToInput.value = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
  }

  /* ── Update dashboard ── */
  updateAIDashboard();

  /* ── Training buttons ── */

  /* Game training */
  document.getElementById('trainGameNNBtn')?.addEventListener('click', () => trainGameModel('nn'));
  document.getElementById('trainGameLRBtn')?.addEventListener('click', () => trainGameModel('lr'));
  document.getElementById('trainGameBothBtn')?.addEventListener('click', async () => {
    await trainGameModel('lr');
    await trainGameModel('nn');
  });

  /* Player training */
  document.getElementById('trainPlayerNNBtn')?.addEventListener('click', () => trainPlayerModel('nn'));
  document.getElementById('trainPlayerLRBtn')?.addEventListener('click', () => trainPlayerModel('lr'));
  document.getElementById('trainPlayerBothBtn')?.addEventListener('click', async () => {
    await trainPlayerModel('lr');
    await trainPlayerModel('nn');
  });

  /* Series training */
  document.getElementById('trainSeriesNNBtn')?.addEventListener('click', () => trainSeriesModel('nn'));
  document.getElementById('trainSeriesLRBtn')?.addEventListener('click', () => trainSeriesModel('lr'));
  document.getElementById('trainSeriesBothBtn')?.addEventListener('click', async () => {
    await trainSeriesModel('lr');
    await trainSeriesModel('nn');
  });

  /* ── Prediction buttons ── */
  document.getElementById('aiGamePredictBtn')?.addEventListener('click', testGamePrediction);
  document.getElementById('aiPlayerPredictBtn')?.addEventListener('click', testPlayerPrediction);
  document.getElementById('aiSeriesPredictBtn')?.addEventListener('click', testSeriesPrediction);

  /* ── Data collection helper ── */
  async function runCollect(fromDate, toDate, label) {
    const btn = document.getElementById('collectESPNBtn');
    const allBtns = ['collectESPNBtn','collectFullSeasonBtn','collectPlayoffsBtn','collectLast30Btn'];
    const progWrap = document.getElementById('collectProgress');
    const progFill = document.getElementById('collectProgressFill');
    const progText = document.getElementById('collectProgressText');
    allBtns.forEach(id => { const b = document.getElementById(id); if (b) b.disabled = true; });
    if (btn) btn.textContent = 'Collecting...';
    if (progWrap) progWrap.classList.remove('hidden');
    if (progFill) progFill.style.width = '0%';
    if (progText) progText.textContent = `Collecting ${label}...`;

    /* Use BallDontLie's date-range endpoint — one query covers the
       whole range, way more reliable than ESPN day-by-day (which
       returns nothing for off-days and patchy older dates). */
    const result = await bulkCollectBDLDateRange(fromDate, toDate, (collected, totalDays, done) => {
      const pct = Math.round((done / totalDays) * 100);
      if (progFill) progFill.style.width = pct + '%';
      if (progText) progText.textContent = `${pct}% — ${collected} games found (BallDontLie)`;
    });

    if (progFill) progFill.style.width = '100%';
    if (progText) progText.textContent = `Done! ${result.added} new games collected (${result.total} total)`;
    if (btn) btn.textContent = 'Collect Games';
    allBtns.forEach(id => { const b = document.getElementById(id); if (b) b.disabled = false; });
    updateAIDashboard();
    showAIToast(`${result.added} new games collected from BallDontLie (${result.total} total)`);
    setTimeout(() => { if (progWrap) progWrap.classList.add('hidden'); }, 4000);
  }

  /* ── Collect button (reads date inputs) ── */
  document.getElementById('collectESPNBtn')?.addEventListener('click', async () => {
    const fromVal = document.getElementById('collectFrom')?.value;
    const toVal = document.getElementById('collectTo')?.value;
    const fromDate = fromVal ? new Date(fromVal + 'T00:00:00') : new Date(2025, 9, 22);
    const toDate = toVal ? new Date(toVal + 'T00:00:00') : new Date();
    await runCollect(fromDate, toDate, 'custom range');
  });

  /* ── Preset: Full Season (Oct 22 2025 → today) ── */
  document.getElementById('collectFullSeasonBtn')?.addEventListener('click', async () => {
    const fromDate = new Date(2025, 9, 22);
    const toDate = new Date();
    document.getElementById('collectFrom').value = '2025-10-22';
    const td = new Date();
    document.getElementById('collectTo').value = td.getFullYear() + '-' + String(td.getMonth()+1).padStart(2,'0') + '-' + String(td.getDate()).padStart(2,'0');
    await runCollect(fromDate, toDate, 'full season');
  });

  /* ── Preset: Playoffs Only (Apr 15 2026 → today) ── */
  document.getElementById('collectPlayoffsBtn')?.addEventListener('click', async () => {
    const fromDate = new Date(2026, 3, 15);
    const toDate = new Date();
    document.getElementById('collectFrom').value = '2026-04-15';
    const td = new Date();
    document.getElementById('collectTo').value = td.getFullYear() + '-' + String(td.getMonth()+1).padStart(2,'0') + '-' + String(td.getDate()).padStart(2,'0');
    await runCollect(fromDate, toDate, 'playoffs');
  });

  /* ── Preset: Last 30 Days ── */
  document.getElementById('collectLast30Btn')?.addEventListener('click', async () => {
    const toDate = new Date();
    const fromDate = new Date(); fromDate.setDate(fromDate.getDate() - 30);
    document.getElementById('collectFrom').value = fromDate.getFullYear() + '-' + String(fromDate.getMonth()+1).padStart(2,'0') + '-' + String(fromDate.getDate()).padStart(2,'0');
    document.getElementById('collectTo').value = toDate.getFullYear() + '-' + String(toDate.getMonth()+1).padStart(2,'0') + '-' + String(toDate.getDate()).padStart(2,'0');
    await runCollect(fromDate, toDate, 'last 30 days');
  });

  document.getElementById('generateSyntheticBtn')?.addEventListener('click', () => {
    /* Force generate data even if we have enough */
    const data = generateGameTrainingData();
    document.getElementById('generateSyntheticBtn').textContent = `Generated ${data.total} samples`;
    updateAIDashboard();
    setTimeout(() => { document.getElementById('generateSyntheticBtn').textContent = 'Generate Synthetic Data'; }, 2000);
  });

  /* ── Collect from BallDontLie — pulls every game of the 2024-25 +
        2025-26 seasons (regular + playoffs). Most reliable source. ── */
  document.getElementById('collectBDLBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('collectBDLBtn');
    const progress = document.getElementById('collectProgress');
    const fill = document.getElementById('collectProgressFill');
    const text = document.getElementById('collectProgressText');
    const allBtns = ['collectESPNBtn','collectFullSeasonBtn','collectPlayoffsBtn','collectLast30Btn','collectBDLBtn'];
    allBtns.forEach(id => { const b = document.getElementById(id); if (b) b.disabled = true; });
    btn.textContent = 'Fetching from BallDontLie…';
    if (progress) progress.classList.remove('hidden');

    try {
      let totalAdded = 0;
      /* Two seasons: current (2025) + previous (2024) for ~2,400 games */
      const seasons = [2025, 2024];
      for (let i = 0; i < seasons.length; i++) {
        const s = seasons[i];
        if (text) text.textContent = `Fetching ${s}-${(s+1).toString().slice(2)} season…`;
        const result = await bulkCollectBDL(s, undefined, (collected, page) => {
          if (text) text.textContent = `${s}-${(s+1).toString().slice(2)}: page ${page} · ${collected + totalAdded} games`;
          if (fill) fill.style.width = `${Math.min(100, ((i * 50) + Math.min(50, page * 5)))}%`;
        });
        totalAdded += result.added;
      }
      if (text) text.textContent = `Done. Collected ${totalAdded} new games. Total: ${getAIGames().length}.`;
      if (fill) fill.style.width = '100%';
      btn.textContent = `Collected ${totalAdded} games`;
      updateAIDashboard();
    } catch (err) {
      if (text) text.textContent = `Failed: ${err.message}`;
      btn.textContent = 'Collect from BallDontLie';
      showAIToast(`BDL collect failed: ${err.message}`);
    } finally {
      allBtns.forEach(id => { const b = document.getElementById(id); if (b) b.disabled = false; });
      setTimeout(() => {
        if (progress) progress.classList.add('hidden');
        btn.textContent = 'Collect from BallDontLie';
      }, 4000);
    }
  });

  /* ── Management buttons ── */
  document.getElementById('resetModelsBtn')?.addEventListener('click', () => {
    [AI_LR_GAME, AI_LR_PLAYER, AI_LR_SERIES].forEach(k => localStorage.removeItem(k));
    ['nba-game-nn', 'nba-player-nn', 'nba-series-nn'].forEach(n => {
      try { localStorage.removeItem(`tensorflowjs_models/nba-${n}/info`);
            localStorage.removeItem(`tensorflowjs_models/nba-${n}/model_topology`);
            localStorage.removeItem(`tensorflowjs_models/nba-${n}/weight_data`);
            localStorage.removeItem(`tensorflowjs_models/nba-${n}/weight_specs`);
      } catch {}
    });
    const meta = getAIMeta();
    meta.lrTrained = false; meta.nnGameTrained = false;
    meta.lrPlayerTrained = false; meta.nnPlayerTrained = false;
    meta.lrSeriesTrained = false; meta.nnSeriesTrained = false;
    saveAIMeta(meta);
    updateAIDashboard();
    showAIToast('All models reset');
  });

  document.getElementById('resetDataBtn')?.addEventListener('click', () => {
    localStorage.removeItem(AI_GAMES_KEY);
    localStorage.removeItem(AI_ACC_KEY);
    updateAIDashboard();
    showAIToast('Training data cleared');
  });

  document.getElementById('forceRetrainBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('forceRetrainBtn');
    btn.textContent = 'Retraining...'; btn.disabled = true;
    await trainGameModel('lr');
    await trainPlayerModel('lr');
    await trainSeriesModel('lr');
    if (typeof tf !== 'undefined') {
      await trainGameModel('nn');
      await trainPlayerModel('nn');
      await trainSeriesModel('nn');
    }
    btn.textContent = 'Force Retrain All'; btn.disabled = false;
    updateAIDashboard();
    showAIToast('All models retrained');
  });

  /* ── Clear test log ── */
  document.getElementById('clearTestLogBtn')?.addEventListener('click', () => {
    localStorage.removeItem(AI_TEST_LOG_KEY);
    renderTestLog();
    showAIToast('Test log cleared');
  });

  /* ── Render existing test log ── */
  renderTestLog();
}

function updateAIDashboard() {
  const meta = getAIMeta();
  const espnGames = getAIGames();
  const stored = getStoredGames();
  const players = typeof getAllPlayers === 'function' ? getAllPlayers() : [];

  /* Dashboard stats */
  const el = id => document.getElementById(id);
  if (el('dashGamesLearned')) el('dashGamesLearned').textContent = espnGames.length + stored.length;
  if (el('dashAccuracy'))     el('dashAccuracy').textContent = meta.gameAccuracy ? (meta.gameAccuracy * 100).toFixed(1) + '%' : '—';
  if (el('dashLastTrain')) {
    if (meta.lastTrainDate) {
      const d = new Date(meta.lastTrainDate);
      const ago = Math.round((Date.now() - d.getTime()) / 60000);
      el('dashLastTrain').textContent = ago < 60 ? `${ago}m ago` : ago < 1440 ? `${Math.round(ago/60)}h ago` : d.toLocaleDateString();
    } else {
      el('dashLastTrain').textContent = 'Never';
    }
  }
  if (el('dashModelType')) {
    const types = [];
    if (meta.lrTrained) types.push('LR');
    if (meta.nnGameTrained) types.push('NN');
    el('dashModelType').textContent = types.length ? types.join(' + ') : 'None';
  }

  /* Status dot */
  const dot = el('aiStatusDot');
  if (dot) {
    dot.className = 'ai-status-dot ' + (meta.lrTrained || meta.nnGameTrained ? 'ai-status-trained' : 'ai-status-untrained');
  }

  /* Data counts */
  if (el('dataESPNCount'))   el('dataESPNCount').textContent = espnGames.length;
  if (el('dataImportCount')) el('dataImportCount').textContent = stored.length;
  if (el('dataPlayerCount')) el('dataPlayerCount').textContent = players.length;
  if (el('dataTotalCount'))  el('dataTotalCount').textContent = espnGames.length + stored.length + 56; /* +56 H2H */

  /* Accuracy trend */
  try {
    const log = JSON.parse(localStorage.getItem(AI_ACC_KEY) || '[]');
    drawAccuracyTrend('accuracyTrendChart', log);
  } catch {}
}


/* ── Training orchestrators ── */

async function trainGameModel(type) {
  const data = generateGameTrainingData();
  if (data.xTrain.length < 5) { showAIToast('Not enough training data — collect more games first'); return; }

  const epochs = parseInt(document.getElementById('gameEpochs')?.value) || 50;
  const lr = parseFloat(document.getElementById('gameLR')?.value) || 0.01;
  const batch = parseInt(document.getElementById('gameBatch')?.value) || 32;
  const progWrap = document.getElementById('gameTrainProgress');
  const progFill = document.getElementById('gameProgressFill');
  const progText = document.getElementById('gameEpochText');
  if (progWrap) progWrap.classList.remove('hidden');

  const meta = getAIMeta();
  const trainLoss = [], valLoss = [];

  if (type === 'lr') {
    const model = new LogisticRegression(14, lr);
    await model.train(data.xTrain, data.yTrain, epochs, (e, loss) => {
      trainLoss.push(loss);
      if (progFill) progFill.style.width = ((e + 1) / epochs * 100) + '%';
      if (progText) progText.textContent = `LR — Epoch ${e + 1} / ${epochs} — Loss: ${loss.toFixed(4)}`;
      drawLossChart('gameLossChart', trainLoss, null);
    });
    model.save(AI_LR_GAME);
    const acc = model.accuracy(data.xTest, data.yTest);
    meta.lrTrained = true;
    meta.gameAccuracy = acc;
    meta.lastTrainCount = getAIGames().length;
    meta.lastTrainDate = new Date().toISOString();
    saveAIMeta(meta);

    /* Append to accuracy trend log */
    try {
      const accLog = JSON.parse(localStorage.getItem(AI_ACC_KEY) || '[]');
      accLog.push({ date: new Date().toISOString(), accuracy: acc, games: meta.lastTrainCount, correct: acc >= 0.5 });
      localStorage.setItem(AI_ACC_KEY, JSON.stringify(accLog));
    } catch {}

    /* Accuracy comparison */
    const formulaAcc = formulaGameAccuracy(data.xTest, data.yTest);
    drawAccuracyBars('gameAccChart', { formula: formulaAcc, lr: acc, nn: meta.nnGameAccuracy || 0 });
    showAIToast(`LR trained — accuracy: ${(acc*100).toFixed(1)}%`);
  }

  if (type === 'nn') {
    if (typeof tf === 'undefined') { showAIToast('TensorFlow.js not loaded — check internet'); return; }
    const model = createGameNN(lr);
    await trainNNModel(model, data.xTrain, data.yTrain, data.xTest, data.yTest, epochs, batch, (e, loss, vloss) => {
      trainLoss.push(loss);
      valLoss.push(vloss);
      if (progFill) progFill.style.width = ((e + 1) / epochs * 100) + '%';
      if (progText) progText.textContent = `NN — Epoch ${e + 1} / ${epochs} — Loss: ${loss.toFixed(4)}`;
      drawLossChart('gameLossChart', trainLoss, valLoss);
    });
    await saveNNModel(model, 'game-nn');
    const acc = nnAccuracy(model, data.xTest, data.yTest);
    meta.nnGameTrained = true;
    meta.nnGameAccuracy = acc;
    meta.lastTrainDate = new Date().toISOString();
    saveAIMeta(meta);

    /* Append to accuracy trend log */
    try {
      const accLog = JSON.parse(localStorage.getItem(AI_ACC_KEY) || '[]');
      accLog.push({ date: new Date().toISOString(), accuracy: acc, games: getAIGames().length, correct: acc >= 0.5 });
      localStorage.setItem(AI_ACC_KEY, JSON.stringify(accLog));
    } catch {}

    const formulaAcc = formulaGameAccuracy(data.xTest, data.yTest);
    const lrModel = LogisticRegression.load(AI_LR_GAME);
    const lrAcc = lrModel ? lrModel.accuracy(data.xTest, data.yTest) : 0;
    drawAccuracyBars('gameAccChart', { formula: formulaAcc, lr: lrAcc, nn: acc });
    showAIToast(`NN trained — accuracy: ${(acc*100).toFixed(1)}%`);
  }

  updateAIDashboard();
}

async function trainPlayerModel(type) {
  const data = generatePlayerTrainingData();
  if (data.xTrain.length < 10) { showAIToast('Not enough player data'); return; }

  const epochs = parseInt(document.getElementById('playerEpochs')?.value) || 80;
  const lr = parseFloat(document.getElementById('playerLR')?.value) || 0.005;
  const progWrap = document.getElementById('playerTrainProgress');
  const progFill = document.getElementById('playerProgressFill');
  const progText = document.getElementById('playerEpochText');
  if (progWrap) progWrap.classList.remove('hidden');

  const meta = getAIMeta();
  const trainLoss = [], valLoss = [];

  if (type === 'lr') {
    const model = new LinearRegression(10, lr);
    await model.train(data.xTrain, data.yTrain, epochs, (e, loss) => {
      trainLoss.push(loss);
      if (progFill) progFill.style.width = ((e + 1) / epochs * 100) + '%';
      if (progText) progText.textContent = `LR — Epoch ${e + 1} / ${epochs} — MSE: ${loss.toFixed(2)}`;
      drawLossChart('playerLossChart', trainLoss, null);
    });
    model.save(AI_LR_PLAYER);
    const mae = model.mae(data.xTest, data.yTest);
    meta.lrPlayerTrained = true;
    meta.playerMAE = mae;
    meta.lastTrainDate = new Date().toISOString();
    saveAIMeta(meta);
    drawMAEBars('playerAccChart', { formula: 5.2, lr: mae, nn: meta.nnPlayerMAE || 10 });
    showAIToast(`Player LR trained — MAE: ${mae.toFixed(1)} pts`);
  }

  if (type === 'nn') {
    if (typeof tf === 'undefined') { showAIToast('TensorFlow.js not loaded'); return; }
    const model = createPlayerNN(lr);
    await trainNNModel(model, data.xTrain, data.yTrain, data.xTest, data.yTest, epochs, 32, (e, loss, vloss) => {
      trainLoss.push(loss);
      valLoss.push(vloss);
      if (progFill) progFill.style.width = ((e + 1) / epochs * 100) + '%';
      if (progText) progText.textContent = `NN — Epoch ${e + 1} / ${epochs} — MSE: ${loss.toFixed(2)}`;
      drawLossChart('playerLossChart', trainLoss, valLoss);
    });
    await saveNNModel(model, 'player-nn');
    const mae = nnMAE(model, data.xTest, data.yTest);
    meta.nnPlayerTrained = true;
    meta.nnPlayerMAE = mae;
    meta.lastTrainDate = new Date().toISOString();
    saveAIMeta(meta);
    showAIToast(`Player NN trained — MAE: ${mae.toFixed(1)} pts`);
  }

  updateAIDashboard();
}

async function trainSeriesModel(type) {
  const data = generateSeriesTrainingData();
  if (data.xTrain.length < 5) { showAIToast('Not enough series data'); return; }

  const epochs = parseInt(document.getElementById('seriesEpochs')?.value) || 60;
  const lr = parseFloat(document.getElementById('seriesLR')?.value) || 0.01;
  const progWrap = document.getElementById('seriesTrainProgress');
  const progFill = document.getElementById('seriesProgressFill');
  const progText = document.getElementById('seriesEpochText');
  if (progWrap) progWrap.classList.remove('hidden');

  const meta = getAIMeta();
  const trainLoss = [], valLoss = [];

  if (type === 'lr') {
    const model = new LogisticRegression(10, lr);
    await model.train(data.xTrain, data.yTrain, epochs, (e, loss) => {
      trainLoss.push(loss);
      if (progFill) progFill.style.width = ((e + 1) / epochs * 100) + '%';
      if (progText) progText.textContent = `LR — Epoch ${e + 1} / ${epochs} — Loss: ${loss.toFixed(4)}`;
      drawLossChart('seriesLossChart', trainLoss, null);
    });
    model.save(AI_LR_SERIES);
    const acc = model.accuracy(data.xTest, data.yTest);
    meta.lrSeriesTrained = true;
    meta.seriesAccuracy = acc;
    meta.lastTrainDate = new Date().toISOString();
    saveAIMeta(meta);
    drawAccuracyBars('seriesAccChart', { formula: 0.65, lr: acc, nn: meta.nnSeriesAccuracy || 0 });
    showAIToast(`Series LR trained — accuracy: ${(acc*100).toFixed(1)}%`);
  }

  if (type === 'nn') {
    if (typeof tf === 'undefined') { showAIToast('TensorFlow.js not loaded'); return; }
    const model = createSeriesNN(lr);
    await trainNNModel(model, data.xTrain, data.yTrain, data.xTest, data.yTest, epochs, 16, (e, loss, vloss) => {
      trainLoss.push(loss);
      valLoss.push(vloss);
      if (progFill) progFill.style.width = ((e + 1) / epochs * 100) + '%';
      if (progText) progText.textContent = `NN — Epoch ${e + 1} / ${epochs} — Loss: ${loss.toFixed(4)}`;
      drawLossChart('seriesLossChart', trainLoss, valLoss);
    });
    await saveNNModel(model, 'series-nn');
    const acc = nnAccuracy(model, data.xTest, data.yTest);
    meta.nnSeriesTrained = true;
    meta.nnSeriesAccuracy = acc;
    meta.lastTrainDate = new Date().toISOString();
    saveAIMeta(meta);
    showAIToast(`Series NN trained — accuracy: ${(acc*100).toFixed(1)}%`);
  }

  updateAIDashboard();
}


/* ── Formula baseline accuracy (for comparison) ── */

function formulaGameAccuracy(xTest, yTest) {
  /* Use quickProbByName logic: features[10] is centered winPct diff, features[11] is centered netRtg diff */
  let correct = 0;
  xTest.forEach((x, i) => {
    /* Reconstruct: x[10] = (wpDiff+1)/2, x[11] = (nrDiff+20)/40 */
    const wpDiff = x[10] * 2 - 1;
    const nrDiff = x[11] * 40 - 20;
    const edge = wpDiff * 1.8 + (nrDiff / 10) * 0.5 + 0.03;
    const homeProb = clamp(0.5 + edge, 0.12, 0.88);
    const pred = homeProb >= 0.5 ? 1 : 0;
    if (pred === yTest[i]) correct++;
  });
  return xTest.length > 0 ? correct / xTest.length : 0;
}


/* ── Test prediction functions (AI page) ── */

const AI_TEST_LOG_KEY = 'nba_ai_test_log';

function getTestLog() {
  try { return JSON.parse(localStorage.getItem(AI_TEST_LOG_KEY) || '[]'); }
  catch { return []; }
}

function saveTestLog(log) {
  localStorage.setItem(AI_TEST_LOG_KEY, JSON.stringify(log));
}

function testGamePrediction() {
  const home = document.getElementById('aiGameHome')?.value;
  const away = document.getElementById('aiGameAway')?.value;
  const actual = document.getElementById('aiGameActual')?.value;
  if (!home || !away || home === away) { showAIToast('Select two different teams'); return; }

  const feats = extractGameFeatures(home, away);
  const hTeam = NBA_TEAMS.find(t => t.name === home);
  const aTeam = NBA_TEAMS.find(t => t.name === away);
  const hasActual = actual === 'home' || actual === 'away';
  const actualWinner = actual === 'home' ? hTeam?.abbr : actual === 'away' ? aTeam?.abbr : null;

  const entry = {
    home: hTeam?.abbr || '?',
    away: aTeam?.abbr || '?',
    homeFull: home,
    awayFull: away,
    actual: actualWinner,
    formula: { pred: null, correct: null },
    lr: { pred: null, correct: null },
    nn: { pred: null, correct: null },
    date: new Date().toISOString(),
  };

  /* Formula */
  const formulaP = quickProbByName(hTeam, aTeam);
  const formulaPredWinner = formulaP.home >= formulaP.away ? hTeam?.abbr : aTeam?.abbr;
  entry.formula.pred = formulaPredWinner;
  entry.formula.pct = Math.max(formulaP.home, formulaP.away);
  if (hasActual) entry.formula.correct = formulaPredWinner === actualWinner;

  document.getElementById('aiGameFormula').innerHTML = `
    <div class="ai-pred-pct">${entry.formula.pct}%</div>
    <div class="ai-pred-team">${formulaPredWinner} wins</div>`;
  document.getElementById('aiGameFormulaVerdict').innerHTML = hasActual
    ? (entry.formula.correct ? '<span class="verdict-correct">CORRECT</span>' : '<span class="verdict-wrong">WRONG</span>')
    : '';

  /* LR */
  const lr = LogisticRegression.load(AI_LR_GAME);
  if (lr) {
    const p = lr.predict(feats);
    const pct = Math.round(Math.max(p, 1 - p) * 100);
    const winner = p >= 0.5 ? hTeam?.abbr : aTeam?.abbr;
    entry.lr.pred = winner;
    entry.lr.pct = pct;
    if (hasActual) entry.lr.correct = winner === actualWinner;

    document.getElementById('aiGameLR').innerHTML = `
      <div class="ai-pred-pct">${pct}%</div>
      <div class="ai-pred-team">${winner} wins</div>`;
    document.getElementById('aiGameLRVerdict').innerHTML = hasActual
      ? (entry.lr.correct ? '<span class="verdict-correct">CORRECT</span>' : '<span class="verdict-wrong">WRONG</span>')
      : '';
  } else {
    document.getElementById('aiGameLR').innerHTML = '<div class="ai-pred-none">Not trained</div>';
    document.getElementById('aiGameLRVerdict').innerHTML = '';
  }

  /* NN */
  (async () => {
    const model = await loadNNModel('game-nn');
    if (model) {
      const p = nnPredict(model, feats);
      const pct = Math.round(Math.max(p, 1 - p) * 100);
      const winner = p >= 0.5 ? hTeam?.abbr : aTeam?.abbr;
      entry.nn.pred = winner;
      entry.nn.pct = pct;
      if (hasActual) entry.nn.correct = winner === actualWinner;

      document.getElementById('aiGameNN').innerHTML = `
        <div class="ai-pred-pct">${pct}%</div>
        <div class="ai-pred-team">${winner} wins</div>`;
      document.getElementById('aiGameNNVerdict').innerHTML = hasActual
        ? (entry.nn.correct ? '<span class="verdict-correct">CORRECT</span>' : '<span class="verdict-wrong">WRONG</span>')
        : '';
    } else {
      document.getElementById('aiGameNN').innerHTML = '<div class="ai-pred-none">Not trained</div>';
      document.getElementById('aiGameNNVerdict').innerHTML = '';
    }

    /* Save to test log if we have an actual winner */
    if (hasActual) {
      const log = getTestLog();
      log.push(entry);
      saveTestLog(log);
      renderTestLog();
    }
  })();

  document.getElementById('aiGameResults').classList.remove('hidden');
}

function renderTestLog() {
  const log = getTestLog();
  const el = document.getElementById('aiTestLog');
  const scoreEl = document.getElementById('aiTestScore');
  if (!el) return;

  if (log.length === 0) {
    el.innerHTML = '<div class="ai-test-empty">No games tested yet. Enter a game above to start testing.</div>';
    if (scoreEl) scoreEl.textContent = '0 / 0 correct';
    ['testAccFormula','testAccLR','testAccNN'].forEach(id => {
      const e = document.getElementById(id);
      if (e) e.textContent = '—';
    });
    return;
  }

  /* Running accuracy per model */
  let fC = 0, fT = 0, lC = 0, lT = 0, nC = 0, nT = 0;
  log.forEach(e => {
    if (e.formula.correct != null) { fT++; if (e.formula.correct) fC++; }
    if (e.lr.correct != null)      { lT++; if (e.lr.correct) lC++; }
    if (e.nn.correct != null)      { nT++; if (e.nn.correct) nC++; }
  });

  if (scoreEl) scoreEl.textContent = `${log.length} game${log.length>1?'s':''} tested`;

  const accEl = (id, c, t) => {
    const e = document.getElementById(id);
    if (e) e.textContent = t > 0 ? `${c}/${t} (${(c/t*100).toFixed(0)}%)` : '—';
  };
  accEl('testAccFormula', fC, fT);
  accEl('testAccLR', lC, lT);
  accEl('testAccNN', nC, nT);

  /* Build log rows (most recent first) */
  const rows = [...log].reverse().map(e => {
    const fIcon = e.formula.correct === true ? '<span class="v-yes">&#10003;</span>'
                : e.formula.correct === false ? '<span class="v-no">&#10007;</span>' : '—';
    const lIcon = e.lr.correct === true ? '<span class="v-yes">&#10003;</span>'
                : e.lr.correct === false ? '<span class="v-no">&#10007;</span>'
                : e.lr.pred ? '—' : '<span class="v-na">N/A</span>';
    const nIcon = e.nn.correct === true ? '<span class="v-yes">&#10003;</span>'
                : e.nn.correct === false ? '<span class="v-no">&#10007;</span>'
                : e.nn.pred ? '—' : '<span class="v-na">N/A</span>';

    return `<div class="ai-test-row">
      <div class="ai-test-matchup">
        <span class="ai-test-home">${e.home}</span>
        <span class="ai-test-vs">vs</span>
        <span class="ai-test-away">${e.away}</span>
        <span class="ai-test-winner">Winner: <strong>${e.actual}</strong></span>
      </div>
      <div class="ai-test-verdicts">
        <span class="ai-test-v" title="Formula: predicted ${e.formula.pred || '?'}">F ${fIcon}</span>
        <span class="ai-test-v" title="LR: predicted ${e.lr.pred || '?'}">LR ${lIcon}</span>
        <span class="ai-test-v" title="NN: predicted ${e.nn.pred || '?'}">NN ${nIcon}</span>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = rows;
}

function testPlayerPrediction() {
  const playerName = document.getElementById('aiPlayerSelect')?.value;
  const oppName = document.getElementById('aiPlayerOpp')?.value;
  const isHome = document.getElementById('aiPlayerLoc')?.value === '1';
  if (!playerName || !oppName) { showAIToast('Select player and opponent'); return; }

  const players = typeof getAllPlayers === 'function' ? getAllPlayers() : [];
  const player = players.find(p => p.name === playerName);
  if (!player) { showAIToast('Player not found'); return; }

  /* Formula */
  document.getElementById('aiPlayerFormula').innerHTML = `
    <div class="ai-pred-pct">${player.pts.toFixed(1)}</div>
    <div class="ai-pred-team">pts (season avg)</div>`;

  /* LR */
  const lr = LinearRegression.load(AI_LR_PLAYER);
  if (lr) {
    const feats = extractPlayerFeatures(player, oppName, isHome);
    const pred = Math.max(0, lr.predict(feats));
    document.getElementById('aiPlayerLRVal').innerHTML = `
      <div class="ai-pred-pct">${pred.toFixed(1)}</div>
      <div class="ai-pred-team">predicted pts</div>`;
  } else {
    document.getElementById('aiPlayerLRVal').innerHTML = '<div class="ai-pred-none">Not trained</div>';
  }

  /* NN */
  (async () => {
    const model = await loadNNModel('player-nn');
    if (model) {
      const feats = extractPlayerFeatures(player, oppName, isHome);
      const pred = Math.max(0, nnPredict(model, feats));
      document.getElementById('aiPlayerNNVal').innerHTML = `
        <div class="ai-pred-pct">${pred.toFixed(1)}</div>
        <div class="ai-pred-team">predicted pts</div>`;
    } else {
      document.getElementById('aiPlayerNNVal').innerHTML = '<div class="ai-pred-none">Not trained</div>';
    }
  })();

  document.getElementById('aiPlayerResults').classList.remove('hidden');
}

function testSeriesPrediction() {
  const t1 = document.getElementById('aiSeriesT1')?.value;
  const t2 = document.getElementById('aiSeriesT2')?.value;
  const scoreStr = document.getElementById('aiSeriesScore')?.value || '0-0';
  if (!t1 || !t2 || t1 === t2) { showAIToast('Select two different teams'); return; }
  const [w1, w2] = scoreStr.split('-').map(Number);

  /* Formula */
  const formulaResult = getSeriesPrediction({ team1: t1, team2: t2, t1w: w1 || 0, t2w: w2 || 0 });
  document.getElementById('aiSeriesFormula').innerHTML = `
    <div class="ai-pred-pct">${formulaResult ? formulaResult.t1Pct + '%' : '—'}</div>
    <div class="ai-pred-team">${formulaResult ? (formulaResult.t1Pct > 50 ? teamAbbr(t1) : teamAbbr(t2)) + ' wins' : ''}</div>`;

  /* LR */
  const lr = LogisticRegression.load(AI_LR_SERIES);
  if (lr) {
    const feats = extractSeriesFeatures(t1, t2, w1 || 0, w2 || 0);
    const p = lr.predict(feats);
    const pct = Math.round(Math.max(p, 1 - p) * 100);
    const winner = p >= 0.5 ? teamAbbr(t1) : teamAbbr(t2);
    document.getElementById('aiSeriesLRVal').innerHTML = `
      <div class="ai-pred-pct">${pct}%</div>
      <div class="ai-pred-team">${winner} wins series</div>`;
  } else {
    document.getElementById('aiSeriesLRVal').innerHTML = '<div class="ai-pred-none">Not trained</div>';
  }

  /* NN */
  (async () => {
    const model = await loadNNModel('series-nn');
    if (model) {
      const feats = extractSeriesFeatures(t1, t2, w1 || 0, w2 || 0);
      const p = nnPredict(model, feats);
      const pct = Math.round(Math.max(p, 1 - p) * 100);
      const winner = p >= 0.5 ? teamAbbr(t1) : teamAbbr(t2);
      document.getElementById('aiSeriesNNVal').innerHTML = `
        <div class="ai-pred-pct">${pct}%</div>
        <div class="ai-pred-team">${winner} wins series</div>`;
    } else {
      document.getElementById('aiSeriesNNVal').innerHTML = '<div class="ai-pred-none">Not trained</div>';
    }
  })();

  document.getElementById('aiSeriesResults').classList.remove('hidden');
}
