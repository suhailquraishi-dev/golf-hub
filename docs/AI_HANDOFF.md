# AI Handoff

## Goal

Keep this as a working, extensible social feed page. Do not convert it into a landing page. The first screen should remain the usable Wimbledon ticker plus social-card feed.

## Data Flow

1. `server.mjs` serves static files and API routes.
2. `/api/sport-feed` reads the latest `data/feeds/*-news-YYYY-MM-DD.md`.
3. The markdown parser supports X/Twitter, Reddit, ES articles, and Instagram.
4. Server enrichment tries source media/profile fetching with a 6s timeout.
5. `/api/sport-feed-youtube` fetches verified YouTube videos when `YOUTUBE_API_KEY` is set; otherwise it returns `data/sport-feed-youtube.json`.
6. `assets/js/social-feed.js` builds the YouTube query from feed text, merges YouTube plus markdown items, dedupes, interleaves sources, and renders infinite-scroll cards.
7. Auto-refresh polls every 15 minutes. New item keys are prepended into the rendered feed with a short banner. If the payload is unchanged, nothing new is inserted.
8. `index.html` also contains an embedded packaged-data JSON block for direct `file://` preview. In that mode the page does not call API routes.

## Feed Rules

Source priority and thresholds are documented fully in `docs/FEED_SYSTEM.md`.

Current threshold filters in `server.mjs`:

- Twitter/X: at least 70 likes.
- Instagram: at least 100 likes.
- Reddit: at least 50 upvotes.
- ES articles: no recency or engagement threshold.
- YouTube: verified channels only, published within 48h with 72h retry, over 500 views.

## Current Known Data Caveat

The three Instagram URLs in `data/feeds/tennis-news-2026-07-01.md` are placeholder post shortcodes. The backend correctly attempts source fetch, then falls back to local media because those post URLs do not resolve to real media. Replace them with real `https://www.instagram.com/p/.../` URLs to get source-fetched Instagram images.

The feed currently contains one daily markdown file. Infinite scroll will eventually repeat older cards by design once those items are exhausted. That is not the same as a fresh update. For actual new cards, add a newer `{topic}-news-YYYY-MM-DD.md` file or append new unique URLs/items to the existing latest file.

## Safe Extension Points

- Add a new daily markdown file in `data/feeds/`.
- Add verified YouTube channels in `server.mjs` `verifiedChannels`.
- Add player names/templates in `assets/js/social-feed.js`.
- Add card styling in `index.html`, keeping cards UI-like and avoiding gradients.

## Commands

```bash
npm start
npm run check
```

Local environment variables can live in `.env.local`, which is intentionally gitignored. Do not commit API keys. If the YouTube API returns quota, rate-limit, or permission errors, the server returns `data/sport-feed-youtube.json` with `mode: "fallback"` and a redacted `fallbackReason` instead of breaking the page.

Direct file preview works with embedded data:

```bash
open index.html
```

Use `npm start` for live API/source-fetch behavior.

## Verification Checklist

- `/api/sport-feed` returns `runs`, `lastFile`, `fileCount`, `fetchedAt`, and `diagnostics`.
- Direct `index.html` preview renders from `#socialHubStaticData`.
- No rendered card has a broken image.
- YouTube request includes feed-derived query terms.
- ES cards should show feed headlines, not generic homepage metadata.
- Auto-refresh should prepend genuinely new keys instead of only mutating internal state.
- Infinite scroll appends cards and repeats old cards seamlessly when data is exhausted.
- Ad spaces appear as neutral grey placeholders.
