# 🎾 Tennis — US Trending Feed (YYYY-MM-DD)
# Rename this file to match the date: e.g. tennis-news-2026-07-03.md
# Place in data/feeds/ in the repo root.

## 8:00 AM ET — Morning session label here

1. [X 👁580k ♥19.2k] Tweet text goes here — @twitterhandle · https://x.com/handle/status/REAL_TWEET_ID
2. [ES] Article headline goes here — essentiallysports.com · https://www.essentiallysports.com/article-slug/
3. [IG 👁2.1m ♥88.4k] Instagram caption here — @instagramhandle · https://www.instagram.com/p/POST_CODE/
4. [IG 👁760k ♥31.2k] Reel caption here — @instagramhandle · https://www.instagram.com/reel/REEL_CODE/

## 12:00 PM ET — Afternoon session label here

1. [X 👁320k ♥11.5k] Another tweet — @handle · https://x.com/handle/status/REAL_TWEET_ID
2. [ES] Another article — essentiallysports.com · https://www.essentiallysports.com/another-article/
3. [IG 👁940k ♥39.7k] Another Instagram post — @handle · https://www.instagram.com/p/POST_CODE/

## 7:00 PM ET — Evening session label here

1. [X 👁480k ♥17.1k] Evening tweet — @handle · https://x.com/handle/status/REAL_TWEET_ID
2. [ES] Evening article — essentiallysports.com · https://www.essentiallysports.com/evening-article/

# ─── FORMAT RULES ──────────────────────────────────────────────────────────────
#
# Twitter/X:
#   [X 👁{views} ♥{likes}] {tweet text} — @{handle} · {url}
#   views/likes use k/m suffix (e.g. 580k, 2.1m)
#   url must be a real tweet: https://x.com/{handle}/status/{REAL_ID}
#
# Instagram post:
#   [IG 👁{views} ♥{likes}] {caption} — @{handle} · https://www.instagram.com/p/{CODE}/
#
# Instagram reel:
#   [IG 👁{views} ♥{likes}] {caption} — @{handle} · https://www.instagram.com/reel/{CODE}/
#
# ES article:
#   [ES] {headline} — essentiallysports.com · {full url}
#
# Thresholds (posts below these are auto-filtered out):
#   Twitter  : ♥ ≥ 50 likes
#   Instagram: ♥ ≥ 300 likes
#   YouTube  : ≥ 50,000 views (YouTube is fetched live from API, not in this file)
#
# Priority players (always surfaced first, in this order):
#   Serena Williams, Roger Federer, Novak Djokovic, Rafael Nadal,
#   Carlos Alcaraz, Coco Gauff, Jannik Sinner, Aryna Sabalenka
#
# Rules:
#   - Every URL must be unique across the entire file
#   - Twitter IDs must be real (not made up)
#   - No Reddit entries — they are ignored by the engine
#   - Timestamps are EDT (UTC-4) — engine converts internally
