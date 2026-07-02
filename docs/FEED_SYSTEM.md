## 1. Data Sources & Priority

Show content from these 5 sources in this priority order:

| Priority | Source | Rules |
|---|---|---|
| 1 | **YouTube** | Verified official channels only · published within 48h · >500 views |
| 2 | **Twitter/X** | Any account · ≥70 likes · show all tweets (video tweets get native player) |
| 3 | **ES Articles** | Own articles · any recency |
| 4 | **Instagram** | Any account · ≥100 likes |
| 5 | **Reddit** | r/[topic] · ≥50 upvote score |

> **YouTube only**: filter to verified/official channels (tournament, broadcaster, major media). Fan channels, reaction videos, and watchalongs are excluded. All other sources use engagement thresholds only — no source restriction.

---

## 2. Feed Data File Format

Content for Twitter, Reddit, Instagram, and ES articles comes from a markdown file the editorial agent writes to. One file per day, named `{topic}-news-YYYY-MM-DD.md`, stored in `data/feeds/` folder.

### File structure

```markdown
# 🎾 Tennis — US Trending Feed (2026-07-02)

## 8:15 AM ET — Tennis Trending (US)

_Brief description of this update run._

1. [X 👁580k ♥19.2k] Tweet text here — @handle · https://x.com/handle/status/TWEETID
2. [Reddit ▲1850·445c] Post title — r/tennis · https://reddit.com/r/tennis/comments/ID/slug/
3. [ES] Article headline — essentiallysports.com · https://www.essentiallysports.com/article-slug/
4. [IG 👁760k ♥31.2k] Caption text — @handle · https://www.instagram.com/p/CODE/

## 10:45 AM ET — Tennis Trending (US)

1. [X 👁480k ♥17.1k] Another tweet — @handle · https://x.com/...
...
```

### Line format per source

```
Twitter/X:  [X 👁{views} ♥{likes}] {text} — @{handle} · {url}
Reddit:     [Reddit ▲{score}·{comments}c] {title} — r/{sub} · {url}
ES Article: [ES] {headline} — essentiallysports.com · {url}
Instagram:  [IG 👁{views} ♥{likes}] {caption} — @{handle} · {url}
```

**YouTube is never in the markdown file — always fetched live from the API.**

---

## 3. API Routes to Build

### `GET /api/sport-feed`
Reads the latest `data/feeds/*.md` file, parses it into structured JSON.

**Returns:**
```json
{
  "runs": [
    {
      "time": "8:15 AM ET",
      "label": "Tennis Trending (US)",
      "sport": "tennis",
      "items": [
        { "source": "twitter", "text": "...", "handle": "...", "url": "...", "views": "580k", "likes": "19.2k", "timestamp": "8:15 AM ET" },
        { "source": "reddit", "text": "...", "subreddit": "r/tennis", "url": "...", "score": "1850", "comments": "445", "timestamp": "8:15 AM ET" },
        { "source": "es", "text": "...", "url": "...", "timestamp": "8:15 AM ET" },
        { "source": "instagram", "text": "...", "handle": "...", "url": "...", "views": "760k", "likes": "31.2k", "timestamp": "8:15 AM ET" }
      ]
    }
  ],
  "lastFile": "tennis-news-2026-07-02.md",
  "fileCount": 2,
  "fetchedAt": "2026-07-02T14:45:00.000Z"
}
```

**After parsing, server-side pre-fetch for each item type:**

**Twitter:** Call `https://cdn.syndication.twimg.com/tweet-result?id={TWEET_ID}&lang=en&token=x` — returns `text`, `favorite_count`, `conversation_count`, `user.name`, `user.screen_name`, `user.profile_image_url_https`, `video.poster`, `video.variants[]` (MP4 URLs), `mediaDetails[0].media_url_https`. Attach as `tweetData` on the item.

**ES Articles:** Fetch page HTML with `User-Agent: facebookexternalhit/1.1`, extract:
- `<meta property="og:image" content="...">` → `ogImage`
- `<meta property="og:description" content="...">` → `description`

Run all pre-fetches in parallel with `Promise.allSettled`. Set 6s timeout per request.

---

### `GET /api/sport-feed-youtube?q={query}`
Fetches fresh YouTube videos for the topic.

**YouTube Data API v3 calls:**
```
1. GET /search?part=snippet&q={query}&type=video&order=date&maxResults=50
              &publishedAfter={48h ago ISO}&relevanceLanguage=en&key={API_KEY}

2. GET /videos?part=snippet,statistics&id={videoIds}&key={API_KEY}
```

**Verified channel check** — only include videos where `channelTitle` matches one of:
`wimbledon`, `atp tour`, `wta`, `espn`, `bbc sport`, `sky sports tennis`, `sky sports`, `tennis channel`, `tennis tv`, `us open tennis`, `roland garros`, `australian open`, `eurosport`, `amazon prime video sport`, `bt sport`, `nbc sports`, `cbs sports`, `the london standard`, `itf tennis`, `laver cup`, `davis cup`

Match uses word-boundary check (not simple substring) to prevent `"The Sports Huddle"` matching `"sport"`.

**Filter:** `viewCount > 500`

**Sort by trending score:** `views / Math.pow(ageHours + 1, 0.8)` — blends recency and views.

If < 5 verified results in 48h, retry with 72h window.

**Returns:**
```json
{
  "items": [
    {
      "source": "youtube",
      "videoId": "abc123",
      "title": "Djokovic vs Tsitsipas | Wimbledon 2026 Highlights",
      "channel": "Wimbledon",
      "thumbnail": "https://i.ytimg.com/vi/abc123/maxresdefault.jpg",
      "views": 125000,
      "publishedAt": "2026-07-02T09:15:00Z"
    }
  ]
}
```

---

### `GET /api/sport-feed-og?url={url}&source={source}`
Proxy that fetches og:image for a given URL. Module-level in-memory cache.

**Per source strategy:**
- `twitter`: call `https://cdn.syndication.twimg.com/tweet-result?id={tweetId}&lang=en&token=x` → use `photos[0].url` or `mediaDetails[0].media_url_https`
- `instagram`: try Instagram oEmbed first → `https://www.instagram.com/oembed/?url={url}` returns `thumbnail_url`. Fallback: scrape og:image from page.
- `reddit`: fetch `old.reddit.com` URL, scrape og:image
- `es` / default: fetch page with `facebookexternalhit/1.1` UA, scrape og:image

**Returns:** `{ "imageUrl": "https://..." }` or `{ "imageUrl": null }`

---

### `POST /api/sport-feed-captions`
Generates editorial captions using Claude Haiku. Optional — feed works without it.

**Request body:** `{ "items": [{ "key": "url_or_videoId", "source": "youtube", "text": "title text", "handle": "@handle", "channel": "Wimbledon" }] }`

**Claude prompt:**
```
You are an opinionated sports editor. For each post, write ONE editorial line — 5 to 8 words.
Rules:
1. Do NOT copy any words from the post title or text
2. Add your own angle — significance, irony, emotion, or surprise
3. Write in lower case
4. No quotes, hashtags, or emojis
5. If nothing compelling to say, return ""

Examples:
- Post about Serena Williams comeback → "The comeback nobody saw coming, everyone wanted"
- Post about Eala first Filipino win → "Philippines finally gets its Wimbledon moment"
- Post about Djokovic winning → "Djokovic looked untouchable in his opener"

Posts:
1. [YOUTUBE / Wimbledon] Djokovic vs Tsitsipas Extended Highlights Wimbledon 2026
2. [TWITTER / @TheTennisLetter] Alex Eala first Filipino to win at Wimbledon...
...

Return a JSON array of strings, same order. Nothing else.
```

**Model:** `claude-haiku-4-5-20251001` · `max_tokens: 512`

---

## 4. Feed Merging Logic

### Step 1: Build YouTube query from feed content
```javascript
function buildYouTubeQuery(sport, feedItemTexts) {
  const text = feedItemTexts.join(' ').toLowerCase()
  const terms = [sport]  // e.g. "tennis"
  if (text.includes('wimbledon'))        terms.push('wimbledon 2026')
  else if (text.includes('us open'))     terms.push('us open 2026')
  else if (text.includes('french open')) terms.push('roland garros 2026')
  else if (text.includes('australian')) terms.push('australian open 2026')
  // Add top mentioned players (check for known names)
  const players = ['serena','sinner','djokovic','swiatek','alcaraz','sabalenka','gauff','fritz','shelton','zverev']
  players.filter(p => text.includes(p)).slice(0, 2).forEach(p => terms.push(p))
  return terms.join(' ')
  // Result: "tennis wimbledon 2026 serena sinner"
}
```

### Step 2: Deduplicate feed items across runs
Walk runs newest-first. Track seen URLs in a Set. Skip duplicates.

### Step 3: Interleave sources
Use 4 rotation patterns — change pattern every 15 minutes so the lead source varies:

```javascript
const PATTERNS = [
  ['twitter','youtube','es','reddit','youtube','instagram','es','twitter','youtube','reddit'],
  ['youtube','es','twitter','youtube','instagram','reddit','youtube','es','twitter','reddit'],
  ['es','twitter','youtube','reddit','youtube','es','instagram','youtube','twitter','reddit'],
  ['reddit','youtube','twitter','es','youtube','instagram','twitter','youtube','es','reddit'],
]
const patternIdx = Math.floor(Date.now() / (15 * 60 * 1000)) % 4
const pattern = PATTERNS[patternIdx]
```

**Algorithm:** Group items by source. Walk the pattern cyclically, pulling one item per source slot per pass. Append any items not placed by the pattern.

### Step 4: Sort by recency before interleaving
Sort all items by age (newest first) before grouping, so each source group is in recency order.

---

## 5. Age Calculation

Feed items have timestamps like `"8:15 AM ET"`. Convert to age:
```javascript
function ageHours(timestamp) {
  // Parse "H:MM AM/PM ET"
  const [_, h, m, ampm] = timestamp.match(/(\d+):(\d+)\s*(AM|PM)/i)
  let hour = parseInt(h), min = parseInt(m)
  if (ampm === 'PM' && hour !== 12) hour += 12
  if (ampm === 'AM' && hour === 12) hour = 0
  const utcHour = hour + 4  // EDT = UTC-4
  let date = new Date(Date.UTC(now.year, now.month, now.date, utcHour, min))
  if (date > now) date = yesterday(date)  // timestamp in the future = yesterday
  return (Date.now() - date) / 3_600_000
}
```

YouTube items: use ISO `publishedAt` string directly.

---

## 6. Editorial Caption Engine (no API needed)

If Claude API unavailable, generate captions from content using templates:

### Extract players
Map content text against known player names → short editorial name:
```
"serena williams" → "Serena"   |  "novak djokovic" → "Djokovic"
"jannik sinner"   → "Sinner"   |  "iga swiatek"    → "Swiatek"
"aryna sabalenka" → "Sabalenka"|  "coco gauff"     → "Gauff"
"alex eala"       → "Eala"     |  "otto virtanen"  → "Virtanen"
"carlos alcaraz"  → "Alcaraz"  |  "taylor fritz"   → "Fritz"
"alexander zverev"→ "Zverev"   |  "elena rybakina" → "Rybakina"
```

### Detect event type
```
emotional:  text contains "emotional","tears","crying","broke down","sobbing"
historic:   text contains "historic","history","first ever","first player","first time"
upset:      text contains "upset","stuns","shock loss","shock win","knocks out"
comeback:   text contains "comeback","return","returns","came back"
funny:      text contains "hilarious","funny","jokes","laughing"
thriller:   text contains "five-set","thriller","epic battle","marathon"
win:        text contains "def.","defeated","beats","champion","wins"
```

### Build caption
```
emotional → "{P1}'s raw emotion steals the spotlight"
historic  → "{P1} writes their name into tournament history"
upset     → "{P1} stuns {P2} — the shock of the day"
comeback  → "{P1}'s return — the moment everyone wanted to see"
funny     → "{P1} proves there's more to tennis than the game"
thriller  → "{P1} vs {P2} — match of the tournament"
win       → "{P1} gets past {P2} and keeps the title dream alive"
default   → "{P1} in the spotlight today"

No player found:
  upset    → "A shock result no one saw coming"
  emotional→ "Raw emotion on display today"
  historic → "A moment the sport will remember"
  default  → "A moment worth watching"
```

For ES articles: use first sentence of `og:description` as the caption.

---

## 7. Auto-Refresh (15 minutes)

```javascript
// Every 15 minutes — auto-insert new posts at top, no user action needed
setInterval(async () => {
  const latest = await fetchFeed()  // fetch /api/sport-feed + /api/sport-feed-youtube
  const fresh = latest.filter(item => !knownKeys.has(key(item)))
  if (fresh.length === 0) return
  fresh.forEach(item => knownKeys.add(key(item)))
  setItems(prev => interleaveSources([...fresh, ...prev]))
  // Show "↑ N new posts added" banner for 4 seconds
  showBanner(fresh.length)
  setTimeout(hideBanner, 4000)
}, 15 * 60 * 1000)
```

---

## 8. Card Types & Data Available

### YouTube Card
Display: thumbnail (click to embed `<iframe src="youtube.com/embed/{id}?autoplay=1">`), channel name, title, views formatted (`170K views`)

### Twitter Card
Display: avatar, display name, @handle, tweet text (strip `t.co` URLs), like count
If `tweetData.video.variants` has MP4: show `<video controls>` with direct MP4 URL
If only poster image: show image with "Watch on X ↗" overlay

### ES Article Card
Display: `ogImage` (16:9), headline, `description` (first sentence, italic), "Read more →" link

### Instagram Card
Display: caption text above image, `og:image` square (1:1 ratio), handle + stats overlaid on image, link to post

### Reddit Card
Display: subreddit badge, post title, upvote pill (orange), comment count

---

## 9. Pagination

Show 50 items on first load. "Load more · N remaining" button reveals next 50. When auto-refresh inserts new items at top, counter stays at current position.

---

## 10. Environment Variables

```
YOUTUBE_API_KEY       YouTube Data API v3 (Google Cloud Console, free)
ANTHROPIC_API_KEY     Claude API (optional — captions fall back to templates)
SPORT_FEED_DIR        Override feed file directory (default: data/feeds/)
```

---

## How to use this file

1. Open a new Claude Code session in your new project
2. Paste this entire file as your first message
3. Add: *"Implement this using [your framework] and [your design system]. The UI should look like [describe your design]. Sport topic: [your sport]."*
4. Claude will build all API routes, data parsing, interleaving logic, captions, and auto-refresh
5. You bring your own design — Claude brings this logic

The output data shape (card types, field names, feed format) stays identical regardless of which framework or design you use.
