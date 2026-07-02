# Social Hub Production Handoff

## Feed contract

The page reads `data/social-feed.json` and renders cards by `platform`.

Production can supply data in either of two ways:

1. Set `window.__SOCIAL_HUB_DATA__ = { items: [...] }` before `social-feed.js` loads.
2. Change `data-feed-endpoint` on `#socialFeed` to an API route returning the same shape.

If loading fails, the server-rendered cards already present in `index.html` remain visible.

## Required fields

Every item needs:

- `id`: stable source identifier
- `platform`: `instagram`, `youtube`, `facebook`, `reddit`, `threads`, or `update`
- `size`: `mini`, `short`, `medium`, `tall`, or `wide`
- `author`: `name`, `avatar`, `avatarAlt`, and an accurate `verified` boolean
- `context`: compact platform/timestamp line
- `sourceUrl`: canonical post or article URL

Image-bearing cards also need `media.src`, `media.alt`, `media.aspect`, and
`media.sourceUrl`. Production should proxy/cache remote media through an approved
image service instead of hotlinking third-party assets.

Cards may also include a `cardTitle` string for the editorial context above the
platform UI. It renders in the Acumin bold display style before the account row.

The page now points at `/api/sport-feed` plus `/api/sport-feed-youtube?q=tennis`
and keeps static JSON fallbacks at `data/sport-feed.json` and
`data/sport-feed-youtube.json`. Run `node server.mjs` for the local backend. The
server parses the latest markdown feed, then tries source image/profile fetches
using Twitter syndication, Instagram oEmbed/OG, old Reddit OG, and ES OG tags,
with a 6s timeout and in-memory cache. If a source blocks scraping, the response
falls back to curated local art so cards do not render blank.

The frontend deduplicates by URL, rotates sources with the 15-minute source
pattern, appends future ad slots, and adds more cards through infinite scroll.
When the normalized dataset is exhausted, the cursor wraps to the beginning and
appends older cards again with unique DOM ids so the flow does not stop.

Editorial markdown belongs in `data/feeds/{topic}-news-YYYY-MM-DD.md`; the sample
fixture follows the requested line format for X, Reddit, ES, and Instagram.
YouTube stays outside markdown and is merged from the YouTube payload.

Video cards use `media.type: "video-player"` with `media.sourceUrl`,
`media.src`, `media.duration`, and `media.sourceName`. The hub renders a
thumbnail first, then replaces it with a `<youtube-video controls>` custom
element using the YouTube watch URL. The page imports `youtube-video-element`
from jsDelivr so the player renders with YouTube controls inside the card.

Do not pass platform-native like/comment/share/vote controls or counters into
card content. The hub renders its own `Like` and `Share` controls so engagement
events can be owned by EssentiallySports.

## Rendering and safety

- Platform UI is selected by `platform`; content does not contain HTML.
- All feed strings are escaped before insertion.
- Verification badges render only when `author.verified` is `true`.
- Unknown platform values are ignored instead of breaking the feed.
- Card actions are owned by the hub. `Like` persists locally in this static build
  and should map to an ES engagement API in production. `Share` targets the hub
  URL with the card hash.
- `socialfeed:rendered` fires on `document` with the rendered card count.

## Score ticker contract

The top score ticker reads `data/score-ticker.json` from `#scoreTicker` and
polls the endpoint every 30 seconds. Production should point
`data-ticker-endpoint` to a live scores API or edge-cached route that returns
the same shape.

Each ticker item needs:

- `id`: stable match identifier
- `status`: `live` for the red status pill, `recent` for the green status pill
- `badge`: compact set/round label such as `S2`, `S4`, or `R1`
- `court` and `division`
- `playerOne`, `playerTwo`, optional `seedOne`, optional `seedTwo`
- `sets`: array of `{ "p1": "...", "p2": "..." }`
- optional `point`: current point score, also shaped as `{ "p1": "...", "p2": "..." }`

The static build uses current/recent Wimbledon score snapshots and is structured
so the same UI updates automatically when the endpoint changes.
