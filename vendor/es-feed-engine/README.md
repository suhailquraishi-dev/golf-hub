# ES Social Feed Engine — v1.0

Pure logic layer for the EssentiallySports social trending feed.
**No JSX. No CSS. No framework.** Drop into any stack.

---

## What it does

1. Parses feed markdown files → structured post objects
2. Fetches verified YouTube videos (YouTube Data API v3)
3. Pre-fetches tweet media, likes, video URLs (react-tweet, no API key)
4. Scrapes `og:image` + `og:description` from ES article pages
5. Ranks everything: player priority → recency tier → trending score
6. Mixes ES articles 1-per-4 social posts
7. Generates editorial captions — player + event + source-aware

---

## File structure

```
es-feed-engine/
├── dist/
│   ├── index.js          ← compiled JS (require this)
│   └── index.d.ts        ← TypeScript types
├── sample/
│   └── tennis-news-YYYY-MM-DD.md   ← feed file format reference
├── package.json
└── README.md             ← this file
```

---

## Quick start

### Next.js / Node.js (API route)

```js
// pages/api/feed.js  (or app/api/feed/route.js)
const fs = require('fs')
const { buildFeed } = require('es-social-feed-engine')

module.exports = async function handler(req, res) {
  const content  = fs.readFileSync('./data/feeds/tennis-news-2026-07-02.md', 'utf8')
  const { items } = await buildFeed({
    feedFileContent: content,
    feedFileName:    'tennis-news-2026-07-02.md',
    youtubeApiKey:   process.env.YOUTUBE_API_KEY,
  })
  res.json({ items })
}
```

### Vanilla JS / Express

```js
const { buildFeed } = require('./dist/index.js')
const fs = require('fs')

const { items, sport, totalCount } = await buildFeed({
  feedFileContent: fs.readFileSync('./data/feeds/tennis-news-2026-07-02.md', 'utf8'),
  feedFileName:    'tennis-news-2026-07-02.md',
  youtubeApiKey:   process.env.YOUTUBE_API_KEY,
  withTweetData:   true,   // pre-fetch tweet data (server-side only)
  withESImages:    true,   // scrape og:image from articles (server-side only)
  withCaptions:    true,   // generate editorial captions
})

// items = AllFeedItem[]  — render with your own design
```

### Auto-refresh in the browser

```js
const { startAutoRefresh } = require('./dist/index.js')

// Starts polling /api/feed every 15 minutes
// Returns a cleanup function — call it on unmount/destroy
const stop = startAutoRefresh('/api/feed', (allItems, newCount) => {
  console.log(`${newCount} new posts — re-rendering`)
  renderMyFeed(allItems)
})

// Call stop() when the page is destroyed
```

---

## buildFeed() options

| Option | Type | Default | Description |
|---|---|---|---|
| `feedFileContent` | `string` | required | Raw `.md` file content |
| `feedFileName` | `string` | required | File name, e.g. `tennis-news-2026-07-02.md` |
| `youtubeApiKey` | `string` | `''` | Google Cloud YouTube Data API v3 key |
| `withTweetData` | `boolean` | `true` | Pre-fetch tweet media/likes via react-tweet |
| `withESImages` | `boolean` | `true` | Scrape og:image from ES articles |
| `withCaptions` | `boolean` | `true` | Generate editorial captions |

---

## buildFeed() output

```js
{
  items: AllFeedItem[],   // sorted, ranked, ready to render
  sport: string,          // e.g. "tennis"
  totalCount: number,
  lastRun: string,        // timestamp of last feed section, e.g. "7:00 PM ET"
}
```

---

## Item shapes

Every item has `source` and `editorialCaption`. The rest depends on `source`:

```js
// Twitter
{ source: 'twitter', text, handle, url, timestamp, likes, views,
  tweetData: { text, favorite_count, user, video, mediaDetails } }

// Instagram
{ source: 'instagram', text, handle, url, timestamp, likes, views, ogImage }

// ES Article
{ source: 'es', text, url, timestamp, ogImage, description }

// YouTube
{ source: 'youtube', videoId, title, channel, thumbnail, views, publishedAt }
```

---

## Ranking formula

```
rankScore = playerPriorityScore × 1,000,000 + recencyTier + trendScore

playerPriorityScore:
  Serena = 8, Federer = 7, Djokovic = 6, Nadal = 5,
  Alcaraz = 4, Gauff = 3, Sinner = 2, Sabalenka = 1, else = 0

recencyTier:
  ≤ 1h ago  → +100,000
  ≤ 6h ago  → +50,000
  ≤ 24h ago → +10,000
  older     → +0

trendScore:
  (engagement + 1) / (ageHours + 1)^0.7
```

---

## Engagement thresholds

Posts below these are filtered out before ranking:

| Platform | Threshold |
|---|---|
| Twitter/X | ≥ 50 likes |
| Instagram | ≥ 300 likes |
| YouTube | ≥ 50,000 views |
| ES articles | always included |

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `YOUTUBE_API_KEY` | Yes (for YouTube) | Google Cloud, YouTube Data API v3. Quota: 10,000 units/day. Resets midnight Pacific. |
| `ANTHROPIC_API_KEY` | No | Only if you add AI caption generation on top |

---

## Feed file format

See `sample/tennis-news-YYYY-MM-DD.md` for the full format with rules.

Name files: `{sport}-news-YYYY-MM-DD.md`
Place in: `data/feeds/` in your repo root.

```
## 7:00 PM ET — Wimbledon Round 2 Results

1. [X 👁580k ♥19.2k] Sinner cruises past Borges — @atptour · https://x.com/atptour/status/2072200000000000002
2. [ES] Sinner flaw has Roddick worried — essentiallysports.com · https://www.essentiallysports.com/...
3. [IG 👁2.1m ♥88.4k] Serena's comeback moment — @Wimbledon · https://www.instagram.com/p/DaK8NUUjR_b/
4. [IG 👁760k ♥31.2k] Sinner in flight — @atptour · https://www.instagram.com/reel/DaL3qhxyVmy/
```

---

## Tuning CONFIG

All thresholds, priority players, and verified channels live in `CONFIG` at the top of `dist/index.js`. Edit directly if needed:

```js
const { CONFIG } = require('./dist/index.js')

// Raise the Instagram threshold
CONFIG.MIN_INSTAGRAM_LIKES = 500

// Add a new priority player
CONFIG.PRIORITY_PLAYERS.unshift(['emma raducanu', 'raducanu'])

// Add a new verified YouTube channel
CONFIG.VERIFIED_YOUTUBE_CHANNELS.push('eurosport tennis')
```

---

## Dependencies

- `react-tweet` (optional, peer dep) — for pre-fetching tweet data server-side
- Node.js ≥ 18 — uses native `fetch`, `AbortSignal.timeout`, `ReadableStream`
- No other runtime dependencies
