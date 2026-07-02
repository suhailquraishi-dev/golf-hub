# EssentiallySports Social Hub

Clean handoff package for the Wimbledon social hub.

## Run

Static packaged preview:

```bash
open index.html
```

This opens with the embedded packaged feed data. It is good for design review and AI handoff.

Live/API mode:

```bash
npm start
```

Then open `http://127.0.0.1:8765/`.

No install step is required for the local server. The app uses Node built-ins and loads the YouTube custom element from CDN in `index.html`.

Use live/API mode when you want source fetching, `/api/sport-feed`, YouTube API, auto-refresh from newer markdown files, or server diagnostics. Plain `index.html` cannot call local API routes, so it uses embedded fallback data.

## Newsletter Entry Links

Link a newsletter post to the hub with its stable card ID:

Use the URL produced by a card's Share button. Its format is:

```text
http://127.0.0.1:8765/?post=stable-card-id
```

The matching post moves to the first feed position and receives a brand-colored
outline. Without a post parameter, the first regular feed card receives the same
treatment. On mobile, the page gives one short preview of the next card after seven
seconds, then returns to the entry card. The preview is skipped when the visitor
interacts with the page or prefers reduced motion. Existing `#card-id` links remain
supported.

## Optional Environment

```bash
YOUTUBE_API_KEY=... npm start
TWITTER_BEARER_TOKEN=... npm start
SPORT_FEED_DIR=/absolute/path/to/data/feeds npm start
PORT=8776 npm start
```

Without `YOUTUBE_API_KEY`, `/api/sport-feed-youtube` uses `data/sport-feed-youtube.json`.
X recent search requires API credits on the app associated with `TWITTER_BEARER_TOKEN`.
You can also put local secrets in `.env.local`; it is ignored by git. Use `.env.example` as the template.

## Important Files

- `index.html` - full page, CSS, static fallback cards, script imports.
- `server.mjs` - local backend, static server, markdown feed parser, source enrichment.
- `assets/js/social-feed.js` - card mapping, interleave logic, infinite scroll, YouTube player replacement.
- `assets/js/score-ticker.js` - Wimbledon ticker rendering.
- `data/feeds/tennis-news-2026-07-01.md` - editorial feed input for Twitter/X, Reddit, ES, and Instagram.
- `data/sport-feed.json` - static feed fallback.
- `data/sport-feed-youtube.json` - YouTube fallback when no API key is present.
- `docs/FEED_SYSTEM.md` - original backend/feed system contract.
- `docs/AI_HANDOFF.md` - concise continuation notes for AI or engineers.

## QC

```bash
npm run check
curl http://127.0.0.1:8765/api/sport-feed
curl "http://127.0.0.1:8765/api/sport-feed-youtube?q=tennis%20wimbledon%202026%20sinner%20djokovic"
```

Expected current API state:

- 12 parsed markdown items.
- Twitter, Reddit, and ES fetch source media.
- Instagram entries use local fallback media until real Instagram post URLs replace the placeholder shortcodes.
- YouTube uses live API when `YOUTUBE_API_KEY` exists, otherwise static fallback.
- If the YouTube API returns quota, rate-limit, or permission errors, the endpoint returns static fallback with `mode: "fallback"` instead of breaking the page.

## Why Repeats Happen

The page does not invent new social posts. Infinite scroll repeats older cards only after the available feed is exhausted, which keeps the page flowing. Real new updates appear when:

- a newer markdown file is added to `data/feeds/`, or
- the current markdown file receives new URLs/items, or
- `YOUTUBE_API_KEY` is set and the YouTube API returns newer verified videos.

The browser auto-refreshes every 15 minutes. When fresh item keys appear, they are inserted at the top and a short `new posts added` banner appears.

When opening `index.html` directly from disk, new data will not appear automatically from APIs. Re-run the static embed step or use `npm start` for live data.

## Notes

The package intentionally excludes unused marketing/workspace images, `.DS_Store` files, and unused avatar/icon sets from the original working folder.
