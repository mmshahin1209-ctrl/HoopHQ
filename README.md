# HoopHQ

**NBA game, player, and playoff predictions — with the math behind every pick.**

HoopHQ is a static web app that forecasts NBA outcomes and *shows you why*. Every prediction comes with the top contributing factors, the model's confidence, and side-by-side picks from three independent models (a rule-based formula, a Logistic Regression, and a TensorFlow.js Neural Network). No backend. No betting. Just transparent basketball analytics.

> Live data from **BallDontLie** and **ESPN**. AI models train in your browser and persist to localStorage — no servers, no accounts.

---

## Features

| Page | What it does |
|---|---|
| **Home** | Live scoreboard of today's games with pulsing LIVE indicators, team logos, and a click-through detail modal with 3-model AI compare. |
| **Predict** | Pick two teams + a date → get a formula win probability, predicted final score, top-3 factors, head-to-head record, and side-by-side LR + NN picks. |
| **Player** | Project a player's points/rebounds/assists against a specific opponent, home/away aware. |
| **Team Stats** | All 30 teams ranked by record, net rating, efficiency, and recent form. |
| **Playoffs** | Live 2025–26 bracket that auto-syncs from BallDontLie + ESPN every 60 seconds. Click any series for a 3-model comparison, regular-season head-to-head, and series-progression dots. Includes a single-bracket simulator and a 100-run championship probability tournament. |
| **AI Lab** | Train and inspect the three Logistic Regression + Neural Network models. Live loss curves on canvas, validation accuracy / MAE, and a one-click BallDontLie bulk import that pulls thousands of games in seconds. |
| **Train Model** | Adjust the formula weights (net rating, win%, recent form, head-to-head, true shooting, turnovers, home court) and retrain on real game data. |
| **How It Works** | Plain-English walkthrough of the prediction methodology. |

---

## How a prediction is made

For any matchup, HoopHQ runs three models in parallel and shows you all three picks:

**1. The Formula** *(rule-based, runs instantly)*
A weighted sum of seven factors, each normalized to a 0-100 score:
- Net rating (24%) — points scored minus allowed per 100 possessions
- Season win% (22%) — overall record this season
- Recent form (13%) — last 10 games
- Head-to-head (12%) — this season's meetings
- True shooting % (13%) — shot efficiency
- Turnover rate (8%) — ball security
- Home court (8%) — bonus for the home team

**2. Logistic Regression** *(pure JavaScript, ~250 bytes)*
Trained on every NBA game we've imported from BallDontLie. Auto-trains on first page load and persists to localStorage — no manual setup.

**3. Neural Network** *(TensorFlow.js, dense layers + sigmoid)*
Train it once at the AI Lab and the trained model persists to localStorage forever. Loads asynchronously when you open a prediction.

For playoff series predictions, a binomial model expands the per-game probability into `P(series ends in 4 / 5 / 6 / 7 games)` *conditional on the current series score* — not pre-series.

---

## Tech stack

- **HTML / CSS / JavaScript** — no build step, no framework
- **TensorFlow.js 4.20** — neural network training and inference in the browser
- **BallDontLie API** — historical and current-season games
- **ESPN public scoreboard** — live in-progress scores + 35-day playoff sync window
- **localStorage** — collected games, trained model weights, saved TF.js models

---

## Run it locally

It's a static site, so you just need a web server. Two easy options:

```bash
# Python (any version 3.x)
python -m http.server 9090

# Or Node
npx serve .
```

Then open `http://localhost:9090` in any modern browser.

If you want neural-network training to work, open `ai.html` once — TensorFlow.js loads via CDN on that page (and on `predict.html` / `playoff.html` / `index.html` for inference).

---

## Auto-trained models

On every page load, HoopHQ trains all three Logistic Regression models (game-winner, series, player-stat) once and persists them to your browser. Subsequent visits load instantly without retraining. The Neural Network models stay manual — train them once at the AI Lab and they're saved forever too.

That means a first-time visitor gets:
- 3-model AI compare working on the very first matchup they look at
- Instant predictions in the live game modal and the playoff series modal
- No "Train at AI Lab" dead-ends, no waiting

---

## Design

HoopHQ uses a custom design system (`HoopHQ Design System`) — warm hardwood + ink neutrals, basketball-flame orange (`#EE5A24`) as the single hot accent, Archivo Expanded for athletic headlines, JetBrains Mono for every number, and the crystal-ball logo as both the brand mark and the loading spinner. Motion is high: the ball spins on load, probability bars sweep from 0 to their value, the LIVE chip pulses, and cards lift on hover.

---

## Credits

- Game data: [BallDontLie API](https://balldontlie.io)
- Live scores + team logos: [ESPN Public Scoreboard](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard)
- Neural networks: [TensorFlow.js](https://www.tensorflow.org/js)
- Typography: [Archivo](https://fonts.google.com/specimen/Archivo), [Archivo Expanded](https://fonts.google.com/specimen/Archivo), [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono)
- Icons / design language: HoopHQ Design System (custom)

---

## License

Personal / educational project. NBA team logos belong to their respective teams; this project links to them on ESPN's public CDN and does not bundle trademarked art.
