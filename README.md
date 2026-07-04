# EssentiallySports Golf Hub

Local handoff package for the Golf Social Hub.

## Run

Static packaged preview:

```bash
open index.html
```

Live/API mode:

```bash
npm start
```

Then open `http://127.0.0.1:8765/`.

Use live/API mode for source fetching, `/api/sport-feed`, YouTube, X, Reddit, ES Golf articles, score/status ticker, and auto-refresh.

## Feed Logic

The hub prioritizes golf stories from the last 12 hours, expanding to 24h and then 48h when needed. It boosts U.S. Open, PGA Tour, LIV Golf, DP World Tour, LPGA, major championship, leaderboard, practice round, press conference, injury, withdrawal, equipment, and breaking-news stories.

Source priority:

1. YouTube
2. YouTube Shorts
3. X
4. EssentiallySports Golf articles
5. Reddit
6. Instagram fallback/editorial items

## Optional Environment

Put local keys in `.env.local`:

```bash
YOUTUBE_API_KEY=
TWITTER_BEARER_TOKEN=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
REDDIT_USERNAME=
REDDIT_PWD=
ANTHROPIC_API_KEY=
SCORE_API_KEY=
PORT=8765
```

`.env.local` is ignored by Git.

## Important Files

- `index.html` - full page, CSS, static fallback cards, script imports.
- `server.mjs` - local backend, live source fetching, source ranking, and static server.
- `assets/js/social-feed.js` - card mapping, interleave logic, infinite scroll, YouTube player replacement.
- `assets/js/score-ticker.js` - ticker rendering.
- `data/feeds/golf-news-2026-07-04.md` - editorial fallback feed input.
- `data/sport-feed.json` - static feed fallback.
- `data/sport-feed-youtube.json` - YouTube fallback.
- `data/score-ticker.json` - ticker fallback.

## QC

```bash
npm run check
curl http://127.0.0.1:8765/api/sport-feed
curl "http://127.0.0.1:8765/api/sport-feed-youtube?q=golf%20U.S.%20Open%20PGA%20Tour"
```
