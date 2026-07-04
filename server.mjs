import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const feedEngine = require("./vendor/es-feed-engine/dist/index.cjs");

const loadEnvFile = (filename) => {
  const fullPath = path.join(root, filename);
  if (!existsSync(fullPath)) return;
  const lines = readFileSync(fullPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) return;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  });
};

loadEnvFile(".env.local");
loadEnvFile(".env");

const feedDir = process.env.SPORT_FEED_DIR || path.join(root, "data", "feeds");
const port = Number(process.env.PORT || 8765);
const cache = new Map();
const titleCache = new Map();
const titlePromptVersion = "golf-summary-v1";
const SPORT = "golf";
const PRIMARY_EVENT = "U.S. Open";
const DEFAULT_WINDOW_HOURS = 12;
const EXTENDED_WINDOW_HOURS = 48;
const integrationStatus = {
  twitter: {
    configured: Boolean(process.env.TWITTER_BEARER_TOKEN),
    mode: process.env.TWITTER_BEARER_TOKEN ? "pending" : "disabled",
    httpStatus: null,
    itemCount: 0,
    lastAttemptAt: null
  }
};
const normalizeChannelName = (value = "") =>
  String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const verifiedChannels = new Set([
  "pga tour",
  "pgatour",
  "the masters",
  "masters",
  "usga",
  "united states golf association usga",
  "u s open",
  "us open",
  "the open",
  "liv golf",
  "liv golf league",
  "dp world tour",
  "lpga",
  "golf channel",
  "nbc sports",
  "cbs sports",
  "espn",
  "sky sports golf",
  "the r and a",
  "r and a",
  "taylormade golf",
  "callaway golf",
  "titleist",
  "ping golf",
  "pxg"
].map(normalizeChannelName));

const officialYoutubeChannels = [
  { handle: "@PGATOUR", channel: "PGA TOUR", profileImage: "assets/profile-images/espn.jpg" },
  { handle: "@TheMasters", channel: "The Masters", profileImage: "assets/profile-images/espn.jpg" },
  { handle: "@usga", channel: "USGA", profileImage: "assets/profile-images/espn.jpg" },
  { handle: "@usopengolf", channel: "U.S. Open", profileImage: "assets/profile-images/espn.jpg" },
  { handle: "@TheOpen", channel: "The Open", profileImage: "assets/profile-images/espn.jpg" },
  { handle: "@livgolf", channel: "LIV Golf", profileImage: "assets/profile-images/espn.jpg" },
  { handle: "@DPWorldTour", channel: "DP World Tour", profileImage: "assets/profile-images/espn.jpg" },
  { handle: "@GolfChannel", channel: "Golf Channel", profileImage: "assets/profile-images/espn.jpg" },
  { handle: "@NBCSports", channel: "NBC Sports", profileImage: "assets/profile-images/espn.jpg" },
  { handle: "@CBSSports", channel: "CBS Sports", profileImage: "assets/profile-images/espn.jpg" },
  { handle: "@espn", channel: "ESPN", profileImage: "assets/profile-images/espn.jpg" },
  { handle: "@SkySportsGolf", channel: "Sky Sports Golf", profileImage: "assets/profile-images/espn.jpg" },
  { handle: "@TaylorMadeGolf", channel: "TaylorMade Golf", profileImage: "assets/profile-images/espn.jpg" },
  { handle: "@CallawayGolf", channel: "Callaway Golf", profileImage: "assets/profile-images/espn.jpg" },
  { handle: "@Titleist", channel: "Titleist", profileImage: "assets/profile-images/espn.jpg" }
];

Object.assign(feedEngine.CONFIG, {
  MIN_TWITTER_LIKES: 70,
  MIN_INSTAGRAM_LIKES: 100,
  MIN_REDDIT_SCORE: 50,
  MIN_YOUTUBE_VIEWS: 500,
  YOUTUBE_WINDOW_HOURS: DEFAULT_WINDOW_HOURS,
  YOUTUBE_WINDOW_EXTENDED_HOURS: EXTENDED_WINDOW_HOURS
});

const profileFallback = (source, handle = "") => {
  const key = String(handle).replace(/^@/, "").toLowerCase();
  const known = {
    pgatour: "assets/profile-images/espn.jpg",
    usga: "assets/profile-images/espn.jpg",
    usopengolf: "assets/profile-images/espn.jpg",
    themasters: "assets/profile-images/espn.jpg",
    theopen: "assets/profile-images/espn.jpg",
    livgolfleague: "assets/profile-images/espn.jpg",
    livgolf: "assets/profile-images/espn.jpg",
    dpworldtour: "assets/profile-images/espn.jpg",
    golfchannel: "assets/profile-images/espn.jpg",
    essentiallysportsmedia: "assets/profile-images/essentiallysports.png",
    essentiallysports: "assets/profile-images/essentiallysports.png",
    espn: "assets/profile-images/espn.jpg"
  };
  if (known[key]) return known[key];
  return {
    twitter: "assets/social-icons/nav-x.svg",
    instagram: "assets/app-icons/instagram.svg",
    reddit: "assets/app-icons/reddit.png",
    es: "assets/profile-images/essentiallysports.png"
  }[source] || "assets/app-icons/es-logo-mark.svg";
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".otf": "font/otf"
};

const json = (res, body, status = 200) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body, null, 2));
};

const timeoutSignal = (milliseconds = 6000) => AbortSignal.timeout(milliseconds);

const redactUrl = (url = "") => {
  try {
    const target = new URL(url);
    if (target.searchParams.has("key")) target.searchParams.set("key", "[redacted]");
    return target.href;
  } catch {
    return String(url).replace(/([?&]key=)[^&]+/i, "$1[redacted]");
  }
};

const fetchText = async (url, headers = {}) => {
  const response = await fetch(url, {
    headers: {
      "user-agent": "facebookexternalhit/1.1",
      ...headers
    },
    signal: timeoutSignal()
  });
  if (!response.ok) throw new Error(`${response.status} ${redactUrl(url)}`);
  return response.text();
};

const fetchJson = async (url, headers = {}, timeoutMilliseconds = 6000) => {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0",
      ...headers
    },
    signal: timeoutSignal(timeoutMilliseconds)
  });
  if (!response.ok) throw new Error(`${response.status} ${redactUrl(url)}`);
  return response.json();
};

const decodeHtml = (value = "") => String(value)
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#039;/g, "'")
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">");

const getMeta = (html, name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i")
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return "";
};

const isGenericEsImage = (url = "") =>
  /essentiallysports-preview-image|logo(?:[-_.]|$)|placeholder/i.test(url);

const getStructuredArticleImage = (html = "") => {
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const body = script.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    try {
      const parsed = JSON.parse(body);
      const nodes = Array.isArray(parsed) ? parsed : parsed["@graph"] || [parsed];
      for (const node of nodes) {
        const image = node?.image;
        const url = typeof image === "string"
          ? image
          : Array.isArray(image)
            ? image[0]?.url || image[0]
            : image?.url;
        if (url && !isGenericEsImage(url)) return url;
      }
    } catch {
      // Continue through malformed or unrelated structured-data blocks.
    }
  }
  return "";
};

const getFeaturedImage = (html = "") => {
  const image = html.match(/<img[^>]+(?:wp-post-image|attachment-post-thumbnail)[^>]+(?:data-lazy-src|data-src|src)=["']([^"']+)["']/i)
    || html.match(/<img[^>]+(?:data-lazy-src|data-src)=["']([^"']+)["'][^>]+(?:wp-post-image|attachment-post-thumbnail)/i);
  return decodeHtml(image?.[1] || "");
};

const tweetIdFromUrl = (url = "") => url.match(/status\/(\d+)/)?.[1] || "";

const oldRedditUrl = (url = "") => url.replace("www.reddit.com", "old.reddit.com").replace("reddit.com", "old.reddit.com");

const parseCount = (value = "") => {
  const raw = String(value).trim().toLowerCase().replace(/,/g, "");
  const match = raw.match(/^([\d.]+)\s*([km])?$/i);
  if (!match) return 0;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return 0;
  if (match[2] === "m") return number * 1_000_000;
  if (match[2] === "k") return number * 1_000;
  return number;
};

const stableHash = (value = "") => {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const passesSourceThreshold = (item) => {
  if (item.source === "twitter") {
    return Number(item.tweetData?.favorite_count || item.likes || 0) >= 70;
  }
  if (item.source === "instagram") return parseCount(item.likes) >= 100;
  if (item.source === "reddit") return parseCount(item.score) >= 50;
  return true;
};

const cached = async (key, fn, ttl = 15 * 60 * 1000) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < ttl) return hit.value;
  const value = await fn().catch((error) => {
    console.warn(`Cached request failed (${key}).`, error.message);
    return null;
  });
  cache.set(key, { time: Date.now(), value });
  return value;
};

const redditToken = async () => {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const username = process.env.REDDIT_USERNAME || process.env.REDDIT_USERENAME;
  const password = process.env.REDDIT_PWD || process.env.REDDIT_PASSWORD;
  if (!clientId || !clientSecret || !username || !password) return null;

  return cached("reddit:token", async () => {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": `essentiallysports-golf-hub/1.0 by ${username}`
      },
      body: new URLSearchParams({
        grant_type: "password",
        username,
        password
      }),
      signal: timeoutSignal()
    });
    if (!response.ok) throw new Error(`Reddit auth returned ${response.status}`);
    const payload = await response.json();
    return payload.access_token || null;
  }, 50 * 60 * 1000);
};

const redditImageFromMetadata = (metadata = {}, id = "") => {
  const item = metadata[id];
  const source = item?.s?.u || item?.s?.gif || item?.s?.mp4;
  return source ? decodeHtml(source) : "";
};

const redditMediaItems = (post = {}) => {
  const gallery = post.gallery_data?.items || [];
  const mediaItems = gallery
    .map((item) => redditImageFromMetadata(post.media_metadata, item.media_id))
    .filter(Boolean)
    .slice(0, 5)
    .map((src, index) => ({
      type: "image",
      src,
      alt: `${post.title} image ${index + 1}`,
      aspect: "wide"
    }));

  if (mediaItems.length) return mediaItems;
  const preview = post.preview?.images?.[0]?.source?.url;
  if (preview) {
    return [{
      type: "image",
      src: decodeHtml(preview),
      alt: post.title,
      aspect: "wide"
    }];
  }
  return [];
};

const redditFeed = async () => {
  const token = await redditToken();
  if (!token) return [];

  const fetchSubreddit = async (subreddit, sort = "hot") => {
    const target = new URL(`https://oauth.reddit.com/r/${subreddit}/${sort}`);
    target.search = new URLSearchParams({
      t: "day",
      limit: "25",
      raw_json: "1"
    }).toString();
    const response = await fetch(target.href, {
      headers: {
        authorization: `Bearer ${token}`,
        "user-agent": "essentiallysports-golf-hub/1.0"
      },
      signal: timeoutSignal()
    });
    if (!response.ok) throw new Error(`Reddit ${subreddit} returned ${response.status}`);
    const payload = await response.json();
    return (payload.data?.children || []).map((child) => child.data).filter(Boolean);
  };

  const posts = await cached("reddit:latest-golf", async () => {
    const subreddits = ["golf", "progolf", "livgolf", "PGA_Tour", "GolfSwing"];
    const settled = await Promise.allSettled(subreddits.flatMap((subreddit) => [
      fetchSubreddit(subreddit, "hot"),
      fetchSubreddit(subreddit, "rising")
    ]));
    const all = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const seen = new Set();
    return all
      .filter((post) => !post.over_18)
      .filter((post) => Number(post.score || 0) >= 50)
      .filter((post) => golfStoryMatch(`${post.title} ${post.selftext || ""}`))
      .filter((post) => {
        if (seen.has(post.permalink)) return false;
        seen.add(post.permalink);
        return true;
      })
      .sort((a, b) => Number(b.created_utc || 0) - Number(a.created_utc || 0))
      .slice(0, 12);
  }, 5 * 60 * 1000);

  return posts.map((post) => {
    const mediaItems = redditMediaItems(post);
    return {
      source: "reddit",
      text: post.title,
      title: post.title,
      subreddit: `r/${post.subreddit}`,
      url: `https://www.reddit.com${post.permalink}`,
      score: String(post.score || 0),
      comments: String(post.num_comments || 0),
      timestamp: new Date(Number(post.created_utc || 0) * 1000).toISOString(),
      publishedAt: new Date(Number(post.created_utc || 0) * 1000).toISOString(),
      imageUrl: mediaItems[0]?.src || null,
      ogImage: mediaItems[0]?.src || null,
      mediaItems,
      profileImage: "assets/app-icons/reddit.png",
      imageFetchStatus: mediaItems.length ? "source" : "none",
      sourceFetchAttempted: true
    };
  });
};

const prominentTwitterPlayers = [
  ["scottie scheffler", 2.15],
  ["rory mcilroy", 2.08],
  ["bryson dechambeau", 2.02],
  ["tiger woods", 1.96],
  ["jon rahm", 1.88],
  ["brooks koepka", 1.82],
  ["xander schauffele", 1.76],
  ["jordan spieth", 1.68],
  ["justin thomas", 1.62],
  ["collin morikawa", 1.58],
  ["ludvig aberg", 1.54],
  ["ludvig åberg", 1.54],
  ["tommy fleetwood", 1.48],
  ["viktor hovland", 1.44],
  ["scheffler", 1.68],
  ["mcilroy", 1.64],
  ["dechambeau", 1.6],
  ["tiger", 1.56],
  ["rahm", 1.5],
  ["koepka", 1.46],
  ["schauffele", 1.42],
  ["spieth", 1.36],
  ["morikawa", 1.32],
  ["fleetwood", 1.28],
  ["hovland", 1.24]
];

const golfBoostTerms = [
  "u.s. open", "us open", "pga tour", "liv golf", "dp world tour", "lpga",
  "masters", "the open", "pga championship", "major championship", "qualifying",
  "practice round", "pairings", "tee times", "press conference", "injury",
  "withdrawal", "equipment", "leaderboard", "final round", "playoff",
  "hole in one", "rules controversy", "record", "breaking"
];

const golfStoryMatch = (text = "") => {
  const normalized = String(text).toLowerCase();
  return /\b(golf|golfer|pga|lpga|liv|usga|u\.s\. open|us open|masters|the open|pga championship|dp world tour|ryder cup|fedex|leaderboard|tee time|fairway|green|birdie|eagle|bogey|putt|caddie|major championship)\b/i.test(normalized)
    || prominentTwitterPlayers.some(([player]) => normalized.includes(player));
};

const golfTopicBoost = (text = "") => {
  const normalized = String(text).toLowerCase();
  let boost = /u\.s\. open|us open/.test(normalized) ? 2.4 : 1;
  golfBoostTerms.forEach((term) => {
    if (normalized.includes(term)) boost += 0.16;
  });
  return Math.min(boost, 3.2);
};

const twitterBearerToken = () => {
  return String(process.env.TWITTER_BEARER_TOKEN || "").trim();
};

const isGolfTwitterStory = (text = "") => {
  const lowerText = String(text).toLowerCase();
  const hasPlayer = prominentTwitterPlayers.some(([player]) => lowerText.includes(player));
  return hasPlayer || golfStoryMatch(lowerText);
};

const twitterFeed = async () => {
  const bearerToken = twitterBearerToken();
  if (!bearerToken) {
    integrationStatus.twitter = {
      configured: false,
      mode: "disabled",
      httpStatus: null,
      itemCount: 0,
      lastAttemptAt: new Date().toISOString()
    };
    return [];
  }

  const result = await cached("twitter:golf-12h:v1", async () => {
    integrationStatus.twitter = {
      configured: true,
      mode: "requesting",
      httpStatus: null,
      itemCount: 0,
      lastAttemptAt: new Date().toISOString()
    };
    const target = new URL("https://api.x.com/2/tweets/search/recent");
    target.search = new URLSearchParams({
      query: "(golf OR \"U.S. Open\" OR \"US Open\" OR PGATOUR OR PGA OR LIVGolf OR LPGA OR \"Rory McIlroy\" OR \"Scottie Scheffler\" OR \"Tiger Woods\" OR \"Bryson DeChambeau\" OR \"Jon Rahm\") lang:en -is:retweet -is:reply",
      start_time: new Date(Date.now() - DEFAULT_WINDOW_HOURS * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      max_results: "100",
      expansions: "author_id,attachments.media_keys",
      "tweet.fields": "id,text,author_id,created_at,public_metrics,attachments,lang,possibly_sensitive",
      "user.fields": "id,name,username,profile_image_url,verified,verified_type,public_metrics",
      "media.fields": "media_key,type,url,preview_image_url,variants,alt_text"
    }).toString();

    const response = await fetch(target.href, {
      headers: {
        authorization: `Bearer ${bearerToken}`,
        accept: "application/json",
        "user-agent": "essentiallysports-golf-hub/1.0"
      },
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      integrationStatus.twitter = {
        ...integrationStatus.twitter,
        mode: response.status === 402 ? "credits-required" : "error",
        httpStatus: response.status,
        reason: String(errorPayload.title || `HTTP ${response.status}`)
      };
      throw new Error(`X recent search returned ${response.status}`);
    }
    const payload = await response.json();
    const users = new Map((payload.includes?.users || []).map((user) => [user.id, user]));
    const media = new Map((payload.includes?.media || []).map((item) => [item.media_key, item]));
    const now = Date.now();

    const items = (payload.data || [])
      .map((tweet) => {
        const user = users.get(tweet.author_id);
        const likes = Number(tweet.public_metrics?.like_count || 0);
        const publishedAt = String(tweet.created_at || "");
        const publishedMs = Date.parse(publishedAt);
        const ageHours = Number.isFinite(publishedMs) ? Math.max(0, (now - publishedMs) / 3_600_000) : Number.POSITIVE_INFINITY;
        if (likes < 70 || ageHours > EXTENDED_WINDOW_HOURS || tweet.possibly_sensitive || !isGolfTwitterStory(tweet.text)) return null;

        const attachedMedia = (tweet.attachments?.media_keys || []).map((key) => media.get(key)).filter(Boolean);
        const photos = attachedMedia
          .filter((item) => item.type === "photo" && item.url)
          .map((item) => ({ url: item.url }));
        const videoMedia = attachedMedia.find((item) => item.type === "video" || item.type === "animated_gif");
        const variants = (videoMedia?.variants || [])
          .filter((variant) => /mp4/i.test(variant.content_type || "") && variant.url)
          .sort((a, b) => Number(b.bit_rate || 0) - Number(a.bit_rate || 0));
        const lowerText = String(tweet.text || "").toLowerCase();
        const playerBoost = prominentTwitterPlayers.reduce((boost, [player, weight]) =>
          lowerText.includes(player) ? Math.max(boost, weight) : boost, 1);
        const recentBoost = ageHours <= 1 ? 3.4 : ageHours <= 3 ? 1.65 : ageHours <= 12 ? 1 : 0.62;
        const verifiedTypeBoost = /business|government/i.test(user.verified_type || "") ? 1.18 : 1;
        const topicBoost = golfTopicBoost(tweet.text);
        const engagement = likes
          + (Number(tweet.public_metrics?.retweet_count || 0) * 2.5)
          + (Number(tweet.public_metrics?.quote_count || 0) * 2)
          + (Number(tweet.public_metrics?.reply_count || 0) * 0.75);
        const followerBoost = 1 + Math.min(0.45, Math.log10(Number(user.public_metrics?.followers_count || 0) + 1) / 20);
        const trendScore = ((engagement + 50) * playerBoost * recentBoost * verifiedTypeBoost * topicBoost * followerBoost) / Math.pow(ageHours + 0.75, 0.82);
        const profileImage = String(user.profile_image_url || "").replace("_normal.", "_400x400.");

        return {
          source: "twitter",
          text: tweet.text,
          title: tweet.text,
          handle: `@${user.username}`,
          url: `https://x.com/${user.username}/status/${tweet.id}`,
          likes: String(likes),
          views: String(tweet.public_metrics?.impression_count || ""),
          timestamp: publishedAt,
          publishedAt,
          profileImage,
          imageUrl: photos[0]?.url || videoMedia?.preview_image_url || null,
          ogImage: photos[0]?.url || videoMedia?.preview_image_url || null,
          trendScore,
          playerPriority: playerBoost,
          sourcePriority: 4,
          recentPriority: recentBoost,
          tweetData: {
            id_str: tweet.id,
            text: tweet.text,
            created_at: publishedAt,
            favorite_count: likes,
            conversation_count: Number(tweet.public_metrics?.reply_count || 0),
            retweet_count: Number(tweet.public_metrics?.retweet_count || 0),
            quote_count: Number(tweet.public_metrics?.quote_count || 0),
            user: {
              id_str: user.id,
              name: user.name,
              screen_name: user.username,
              verified: true,
              verified_type: user.verified_type || "",
              profile_image_url_https: profileImage,
              followers_count: Number(user.public_metrics?.followers_count || 0)
            },
            photos,
            mediaDetails: photos.map((photo) => ({ media_url_https: photo.url })),
            video: videoMedia ? {
              poster: videoMedia.preview_image_url || "",
              variants
            } : null
          },
          imageFetchStatus: attachedMedia.length ? "source" : "none",
          sourceFetchAttempted: true
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.trendScore - a.trendScore || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      .slice(0, 12);
    integrationStatus.twitter = {
      ...integrationStatus.twitter,
      mode: "live",
      httpStatus: 200,
      itemCount: items.length,
      reason: null
    };
    return items;
  }, 2 * 60 * 1000);

  return result || [];
};

const itemPublishedMs = (item = {}, feedDate = "") => {
  const direct = Date.parse(item.publishedAt || item.timestamp || "");
  if (Number.isFinite(direct)) return direct;
  const time = String(item.timestamp || "").match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!time || !feedDate) return 0;
  let hour = Number(time[1]);
  const minute = Number(time[2]);
  const isPm = time[3].toUpperCase() === "PM";
  if (isPm && hour !== 12) hour += 12;
  if (!isPm && hour === 12) hour = 0;
  return Date.parse(`${feedDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-04:00`);
};

const isLatestSourceItem = (item = {}, feedDate = "") => {
  const published = itemPublishedMs(item, feedDate);
  if (!published) return false;
  const ageMs = Date.now() - published;
  const windowHours = item.source === "es" ? EXTENDED_WINDOW_HOURS : item.source === "twitter" ? EXTENDED_WINDOW_HOURS : DEFAULT_WINDOW_HOURS;
  return ageMs >= 0 && ageMs <= windowHours * 60 * 60 * 1000;
};

const sourcePriority = ["youtube", "youtubeShorts", "twitter", "es", "instagram", "reddit"];
const FEED_REFRESH_MS = 15 * 60 * 1000;

const itemSourceBucket = (item = {}) => {
  if (item.source !== "youtube") return item.source || "";
  return item.isShort || /\/shorts\//i.test(item.url || item.sourceUrl || "") ? "youtubeShorts" : "youtube";
};

const sourcePriorityRank = (source = "") => {
  const index = sourcePriority.indexOf(source);
  return index === -1 ? sourcePriority.length : index;
};

const rotatedSourcePriority = () => {
  const rotation = Math.floor(Date.now() / FEED_REFRESH_MS) % sourcePriority.length;
  return [...sourcePriority.slice(rotation), ...sourcePriority.slice(0, rotation)];
};

const sourceEngagement = (item = {}) => {
  if (item.source === "youtube") return Number(item.views || 0);
  if (item.source === "twitter") {
    return Number(item.tweetData?.favorite_count || item.likes || 0)
      + (Number(item.tweetData?.retweet_count || 0) * 2)
      + Number(item.tweetData?.conversation_count || 0);
  }
  if (item.source === "reddit") return Number(item.score || 0);
  if (item.source === "instagram") return parseCount(item.likes);
  return 0;
};

const sourceTrendRank = (item = {}, feedDate = "") => {
  const published = itemPublishedMs(item, feedDate);
  const ageHours = published ? Math.max(0, (Date.now() - published) / 3_600_000) : 999;
  const bucket = itemSourceBucket(item);
  const windowHours = bucket === "twitter" || bucket === "es" ? EXTENDED_WINDOW_HOURS : DEFAULT_WINDOW_HOURS;
  const recency = Math.max(0, windowHours - Math.min(windowHours, ageHours)) * 4;
  const breakingBoost = bucket === "twitter" && ageHours <= 1 ? 26 : 0;
  const serverTrend = Math.log10(Number(item.trendScore || 0) + 1) * 5;
  const engagement = Math.log10(sourceEngagement(item) + 1) * 9;
  const priority = (sourcePriority.length - sourcePriorityRank(bucket)) * 18;
  const topicBoost = golfTopicBoost(`${item.title || ""} ${item.text || ""} ${item.description || ""}`) * 18;
  return priority + recency + breakingBoost + serverTrend + engagement + topicBoost;
};

const mixSourceItems = (items = [], feedDate = "") => {
  const grouped = new Map();
  items.forEach((item) => {
    const bucket = itemSourceBucket(item);
    if (!sourcePriority.includes(bucket)) return;
    if (!grouped.has(bucket)) grouped.set(bucket, []);
    grouped.get(bucket).push(item);
  });
  grouped.forEach((group) => group.sort((a, b) => sourceTrendRank(b, feedDate) - sourceTrendRank(a, feedDate)));

  const output = [];
  while ([...grouped.values()].some((group) => group.length)) {
    let added = false;
    rotatedSourcePriority().forEach((source) => {
      const group = grouped.get(source);
      if (!group?.length) return;
      const candidate = group.shift();
      candidate.feedPriority = sourcePriorityRank(source) + 1;
      output.push(candidate);
      added = true;
    });
    if (!added) break;
  }
  return output;
};

const scrapeOg = async (url, headers = {}) => {
  const html = await fetchText(url, headers);
  const candidates = [
    getMeta(html, "og:image"),
    getMeta(html, "twitter:image"),
    getStructuredArticleImage(html),
    getFeaturedImage(html)
  ];
  return {
    imageUrl: candidates.find((image) => image && !isGenericEsImage(image)) || null,
    description: getMeta(html, "og:description") || "",
    title: getMeta(html, "og:title") || ""
  };
};

const usableDescription = (item, description = "") => {
  if (item.source === "es" && /u\.s\.-based sports media platform/i.test(description)) {
    return item.description || "";
  }
  return description || item.description;
};

const fetchTweetData = async (url) => {
  const id = tweetIdFromUrl(url);
  if (!id) return null;
  return cached(`tweet:${id}`, async () => fetchJson(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=x`));
};

const fetchOgForSource = async (url, source) => cached(`og:${source}:${url}`, async () => {
  if (source === "twitter") {
    const tweetData = await fetchTweetData(url);
    return {
      imageUrl: tweetData?.photos?.[0]?.url || tweetData?.mediaDetails?.[0]?.media_url_https || tweetData?.video?.poster || null,
      profileImage: tweetData?.user?.profile_image_url_https || null,
      tweetData
    };
  }

  if (source === "instagram") {
    try {
      const embed = await fetchJson(`https://www.instagram.com/oembed/?url=${encodeURIComponent(url)}`);
      if (embed?.thumbnail_url) return { imageUrl: embed.thumbnail_url, description: embed.title || "" };
    } catch {}
    return scrapeOg(url);
  }

  if (source === "reddit") return scrapeOg(oldRedditUrl(url));
  return scrapeOg(url, { "user-agent": "facebookexternalhit/1.1" });
});

const parseMarkdownFeed = (source) => {
  const lines = source.split(/\r?\n/);
  const runs = [];
  let current = null;

  for (const line of lines) {
    const header = line.match(/^##\s+(.+?)\s+—\s+(.+)$/);
    if (header) {
      current = { time: header[1].trim(), label: header[2].trim(), sport: SPORT, items: [] };
      runs.push(current);
      continue;
    }
    if (!current) continue;
    const item = line.match(/^\d+\.\s+\[(.+?)\]\s+(.+?)\s+—\s+(.+?)\s+·\s+(https?:\/\/\S+)/);
    if (!item) continue;
    const [, token, text, sourceLabel, url] = item;
    if (token.startsWith("X")) {
      const views = token.match(/👁\s*([^\s]+)/)?.[1] || "";
      const likes = token.match(/♥\s*([^\s]+)/)?.[1] || "";
      current.items.push({ source: "twitter", text, handle: sourceLabel.trim(), url, views, likes, timestamp: current.time });
    } else if (token.startsWith("Reddit")) {
      const score = token.match(/▲\s*([^·\s]+)/)?.[1] || "";
      const comments = token.match(/·\s*([^c\s]+)c/)?.[1] || "";
      current.items.push({ source: "reddit", text, subreddit: sourceLabel.trim(), url, score, comments, timestamp: current.time });
    } else if (token.startsWith("ES")) {
      current.items.push({ source: "es", text, url, timestamp: current.time });
    } else if (token.startsWith("IG")) {
      const views = token.match(/👁\s*([^\s]+)/)?.[1] || "";
      const likes = token.match(/♥\s*([^\s]+)/)?.[1] || "";
      current.items.push({ source: "instagram", text, handle: sourceLabel.trim().replace(/^@/, ""), url, views, likes, timestamp: current.time });
    }
  }
  return runs;
};

const ES_GOLF_FEED_URL = "https://www.essentiallysports.com/category/golf/feed/";
const ES_GOLF_CATEGORY_ID = 2803;

const rssTagValue = (source = "", tag = "") => {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, "i"));
  return decodeHtml((match?.[1] || "").replace(/^<!\[CDATA\[|\]\]>$/g, "").trim());
};

const stripHtml = (value = "") => decodeHtml(String(value)
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim());

const esGolfFeed = async () => {
  const items = await cached("es:golf-rss", async () => {
    const archiveUrl = new URL("https://www.essentiallysports.com/wp-json/wp/v2/posts");
    archiveUrl.search = new URLSearchParams({
      categories: String(ES_GOLF_CATEGORY_ID),
      per_page: "50",
      orderby: "date",
      order: "desc",
      after: new Date(Date.now() - EXTENDED_WINDOW_HOURS * 60 * 60 * 1000).toISOString(),
      _embed: "wp:featuredmedia"
    }).toString();

    const [rssResult, archiveResult] = await Promise.allSettled([
      fetchText(ES_GOLF_FEED_URL, {
        accept: "application/rss+xml, application/xml, text/xml"
      }),
      fetchJson(archiveUrl.href, {}, 20000)
    ]);

    const xml = rssResult.status === "fulfilled" ? rssResult.value : "";
    const rssItems = (xml.match(/<item>[\s\S]*?<\/item>/gi) || []).map((entry) => {
      const mediaUrl = entry.match(/<media:content[^>]+url=["']([^"']+)["']/i)?.[1] || "";
      const title = stripHtml(rssTagValue(entry, "title"));
      const description = stripHtml(rssTagValue(entry, "description"))
        .replace(/\s*The post .* appeared first on EssentiallySports\.?$/i, "")
        .trim();
      const url = rssTagValue(entry, "link");
      const publishedAt = rssTagValue(entry, "pubDate");
      const author = stripHtml(rssTagValue(entry, "dc:creator")) || "EssentiallySports";

      return {
        source: "es",
        text: title,
        title,
        description,
        author,
        url,
        publishedAt,
        timestamp: publishedAt,
        imageUrl: decodeHtml(mediaUrl) || null,
        ogImage: decodeHtml(mediaUrl) || null,
        profileImage: "assets/profile-images/es-logo.jpg",
        imageFetchStatus: mediaUrl ? "source" : "none",
        sourceFetchAttempted: Boolean(mediaUrl),
        sourceFeed: ES_GOLF_FEED_URL
      };
    });

    const archiveItems = (archiveResult.status === "fulfilled" && Array.isArray(archiveResult.value)
      ? archiveResult.value
      : []).map((post) => {
      const imageUrl = post?._embedded?.["wp:featuredmedia"]?.[0]?.source_url || "";
      return {
        source: "es",
        text: stripHtml(post?.title?.rendered),
        title: stripHtml(post?.title?.rendered),
        description: stripHtml(post?.excerpt?.rendered),
        author: "EssentiallySports",
        url: post?.link || "",
        publishedAt: post?.date_gmt ? `${post.date_gmt}Z` : post?.date || "",
        timestamp: post?.date_gmt ? `${post.date_gmt}Z` : post?.date || "",
        imageUrl: imageUrl || null,
        ogImage: imageUrl || null,
        profileImage: "assets/profile-images/es-logo.jpg",
        imageFetchStatus: imageUrl ? "source" : "none",
        sourceFetchAttempted: Boolean(imageUrl),
        sourceFeed: ES_GOLF_FEED_URL
      };
    });

    const seenUrls = new Set();
    return [...rssItems, ...archiveItems]
      .filter((item) => item.title && item.url && item.publishedAt)
      .filter((item) => {
        if (seenUrls.has(item.url)) return false;
        seenUrls.add(item.url);
        return true;
      })
      .sort((a, b) => sourceTrendRank(b) - sourceTrendRank(a) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  }, 2 * 60 * 1000);

  const pool = items || [];
  const within = (hours) => pool.filter((item) => {
    const published = Date.parse(item.publishedAt || item.timestamp || "");
    return Number.isFinite(published) && Date.now() - published <= hours * 3_600_000;
  });
  return within(DEFAULT_WINDOW_HOURS).length >= 6
    ? within(DEFAULT_WINDOW_HOURS)
    : within(24).length >= 6
      ? within(24)
      : within(EXTENDED_WINDOW_HOURS);
};

const latestFeedFile = async () => {
  const entries = await readdir(feedDir);
  const files = entries.filter((name) => /^golf-news-\d{4}-\d{2}-\d{2}\.md$/.test(name)).sort();
  const lastFile = files.at(-1);
  if (!lastFile) throw new Error("No markdown feed files found");
  return { lastFile, fileCount: files.length, fullPath: path.join(feedDir, lastFile) };
};

const sportFeed = async () => {
  const { lastFile, fileCount, fullPath } = await latestFeedFile();
  const feedDate = lastFile.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || "";
  const markdown = await readFile(fullPath, "utf8");

  const engineResult = await feedEngine.buildFeed({
    feedFileContent: markdown,
    feedFileName: lastFile,
    youtubeApiKey: process.env.YOUTUBE_API_KEY || "",
    withTweetData: false,
    withESImages: false,
    withCaptions: true
  });

  const engineItems = (engineResult.items || []).map((item) => ({
    ...item,
    feedDate,
    caption: item.editorialCaption || item.caption || ""
  }));
  const [latestTwitterItems, latestRedditItems, latestEsItems] = await Promise.all([
    twitterFeed(),
    redditFeed(),
    esGolfFeed()
  ]);
  const seenSourceUrls = new Set();
  const items = [...latestTwitterItems, ...latestRedditItems, ...latestEsItems, ...engineItems]
    .filter((item) => {
      const key = item.url || item.videoId || item.text;
      if (!key || seenSourceUrls.has(key)) return false;
      seenSourceUrls.add(key);
      return true;
    })
    .sort((a, b) => itemPublishedMs(b, feedDate) - itemPublishedMs(a, feedDate));

  await Promise.allSettled(items.map(async (item) => {
    if (item.source === "youtube") {
      item.url = item.url || `https://www.youtube.com/watch?v=${item.videoId}`;
      item.imageUrl = item.thumbnail || item.imageUrl || null;
      item.ogImage = item.thumbnail || item.ogImage || null;
      item.profileImage = item.profileImage || profileFallback("youtube", item.channel);
      item.imageFetchStatus = item.thumbnail ? "source" : "none";
      item.sourceFetchAttempted = true;
      return;
    }
    if (item.source === "twitter" && item.tweetData) {
      item.profileImage = item.profileImage || item.tweetData.user?.profile_image_url_https || profileFallback("twitter", item.handle);
      item.imageFetchStatus = item.imageUrl ? "source" : "none";
      item.sourceFetchAttempted = true;
      return;
    }
    if (item.source === "es" && item.imageUrl && item.description) {
      item.profileImage = item.profileImage || profileFallback("es");
      item.imageFetchStatus = "source";
      item.sourceFetchAttempted = true;
      return;
    }
    const enriched = await fetchOgForSource(item.url, item.source);
    const tweetData = enriched?.tweetData || item.tweetData;
    Object.assign(item, {
      text: item.source === "twitter" && tweetData?.text ? tweetData.text : item.text,
      publishedAt: item.source === "twitter" ? tweetData?.created_at || "" : item.publishedAt,
      imageUrl: enriched?.imageUrl || item.imageUrl || null,
      ogImage: enriched?.imageUrl || item.ogImage || null,
      description: usableDescription(item, enriched?.description),
      profileImage: enriched?.profileImage || item.profileImage || profileFallback(item.source, item.handle || item.subreddit),
      tweetData,
      imageFetchStatus: enriched?.imageUrl ? "source" : "none",
      sourceFetchAttempted: true
    });
  }));

  const filtered = items
    .filter((item) => isLatestSourceItem(item, feedDate))
    .filter(passesSourceThreshold);
  const mixed = mixSourceItems(filtered, feedDate);
  const diagnostics = filtered.reduce((summary, item) => {
    summary.total += 1;
    summary.bySource[item.source] = (summary.bySource[item.source] || 0) + 1;
    summary.imageFetchStatus[item.imageFetchStatus] = (summary.imageFetchStatus[item.imageFetchStatus] || 0) + 1;
    return summary;
  }, { total: 0, bySource: {}, imageFetchStatus: {} });

  return {
    sport: engineResult.sport || SPORT,
    items: mixed,
    totalCount: mixed.length,
    lastRun: engineResult.lastRun,
    lastFile,
    fileCount,
    feedDate,
    fetchedAt: new Date().toISOString(),
    sourceEngine: "vendor/es-feed-engine",
    integrations: {
      twitter: { ...integrationStatus.twitter }
    },
    diagnostics
  };
};

const channelIsVerified = (channel = "") => {
  const normalized = normalizeChannelName(channel);
  if (!normalized) return false;
  if (verifiedChannels.has(normalized)) return true;
  return Array.from(verifiedChannels).some((name) =>
    normalized === name || normalized.startsWith(`${name} official`) || normalized.startsWith(`${name} tv`)
  );
};

const textValue = (node) => {
  if (!node || typeof node !== "object") return "";
  if (typeof node.content === "string") return node.content;
  if (typeof node.simpleText === "string") return node.simpleText;
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.runs)) return node.runs.map((run) => run.text || run.content || "").join("");
  return "";
};

const extractYtInitialData = (html = "") => {
  const marker = "var ytInitialData = ";
  let index = html.indexOf(marker);
  if (index < 0) index = html.indexOf("ytInitialData = ");
  if (index < 0) return null;
  index = html.indexOf("{", index);
  if (index < 0) return null;
  const start = index;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (; index < html.length; index += 1) {
    const character = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
    } else if (character === "\"") {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        index += 1;
        break;
      }
    }
  }
  try {
    return JSON.parse(html.slice(start, index));
  } catch {
    return null;
  }
};

const relativeAgeMs = (value = "") => {
  const match = String(value).toLowerCase().match(/(\d+(?:\.\d+)?)\s*(minute|hour|day|week|month|year)s?\s+ago/);
  if (!match) return Number.POSITIVE_INFINITY;
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount)) return Number.POSITIVE_INFINITY;
  const units = {
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000,
    year: 31_536_000_000
  };
  return amount * units[unit];
};

const collectLockups = (node, out = []) => {
  if (!node || typeof node !== "object") return out;
  if (node.lockupViewModel) out.push(node.lockupViewModel);
  Object.values(node).forEach((value) => collectLockups(value, out));
  return out;
};

const youtubeLockupToItem = (lockup, channelConfig, query = "", isShort = false) => {
  const metadata = lockup.metadata?.lockupMetadataViewModel || {};
  const title = textValue(metadata.title);
  const rows = metadata.metadata?.contentMetadataViewModel?.metadataRows || [];
  const parts = rows.flatMap((row) => row.metadataParts || []);
  const partTexts = parts.map((part) => textValue(part.text)).filter(Boolean);
  const viewsText = partTexts.find((part) => /views?/i.test(part)) || "";
  const publishedText = partTexts.find((part) => /ago/i.test(part)) || "";
  const views = parseCount(viewsText.replace(/views?/i, "").trim());
  const ageMs = relativeAgeMs(publishedText);
  const videoId = lockup.contentId || lockup.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId;
  const thumbnail = lockup.contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url?.replace(/\\u0026/g, "&");
  const searchable = `${title} ${channelConfig.channel}`.toLowerCase();
  if (!videoId || !title || !golfStoryMatch(searchable) || views < 500 || ageMs > EXTENDED_WINDOW_HOURS * 3_600_000) return null;
  const publishedAt = new Date(Date.now() - ageMs).toISOString();
  const sourceUrl = isShort
    ? `https://www.youtube.com/shorts/${videoId}`
    : `https://www.youtube.com/watch?v=${videoId}`;
  return {
    source: "youtube",
    videoId,
    title: decodeHtml(title),
    channel: channelConfig.channel,
    thumbnail,
    imageUrl: thumbnail,
    ogImage: thumbnail,
    views,
    publishedAt,
    profileImage: channelConfig.profileImage,
    url: sourceUrl,
    sourceUrl,
    isShort,
    score: views / Math.pow((ageMs / 3_600_000) + 1, 0.8)
  };
};

const youtubeRssItems = async (channelConfig, query = "") => {
  if (!channelConfig.channelId) return [];
  const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelConfig.channelId}`);
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.map((entry) => {
    const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1] || "";
    const title = decodeHtml(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "");
    const sourceUrl = decodeHtml(entry.match(/<link\s+rel=["']alternate["']\s+href=["']([^"']+)/)?.[1] || "");
    const publishedAt = entry.match(/<published>([^<]+)<\/published>/)?.[1] || "";
    const thumbnail = decodeHtml(entry.match(/<media:thumbnail\s+url=["']([^"']+)/)?.[1] || "");
    const views = Number(entry.match(/<media:statistics\s+views=["'](\d+)/)?.[1] || 0);
    const ageHours = (Date.now() - Date.parse(publishedAt)) / 3_600_000;
    const searchable = `${title} ${channelConfig.channel}`;
    if (!videoId || !title || !sourceUrl || !Number.isFinite(ageHours) || ageHours < 0 || ageHours > EXTENDED_WINDOW_HOURS || views < 500 || !golfStoryMatch(searchable)) {
      return null;
    }
    const isShort = /\/shorts\//i.test(sourceUrl);
    return {
      source: "youtube",
      videoId,
      title,
      channel: channelConfig.channel,
      thumbnail,
      imageUrl: thumbnail,
      ogImage: thumbnail,
      views,
      publishedAt,
      profileImage: channelConfig.profileImage,
      url: sourceUrl,
      sourceUrl,
      isShort,
      score: (views * (isShort ? 1.08 : 1)) / Math.pow(ageHours + 1, 0.8)
    };
  }).filter(Boolean);
};

const scrapeOfficialYoutubeFeed = async (query = "", reason = "api-unavailable") => {
  const items = await cached(`youtube-scrape:${query || SPORT}`, async () => {
    const rssResults = await Promise.allSettled(officialYoutubeChannels.map((channel) => youtubeRssItems(channel, query)));
    const rssItems = rssResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    if (rssItems.length) {
      const dedupedRss = new Map(rssItems.map((item) => [item.videoId, item]));
      const all = [...dedupedRss.values()];
      const regular = all.filter((item) => !item.isShort).sort((a, b) => b.score - a.score).slice(0, 12);
      const shorts = all.filter((item) => item.isShort).sort((a, b) => b.score - a.score).slice(0, 8);
      return [...regular, ...shorts];
    }

    const sources = officialYoutubeChannels.flatMap((channel) => [
      { ...channel, path: "videos", isShort: false },
      { ...channel, path: "shorts", isShort: true }
    ]);
    const results = await Promise.allSettled(sources.map(async (channel) => {
      const html = await fetchText(`https://www.youtube.com/${channel.handle}/${channel.path}`, {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        "accept-language": "en-US,en;q=0.9"
      });
      const data = extractYtInitialData(html);
      return collectLockups(data)
        .map((lockup) => youtubeLockupToItem(lockup, channel, query, channel.isShort))
        .filter(Boolean);
    }));
    const deduped = new Map();
    results.forEach((result) => {
      if (result.status !== "fulfilled") return;
      result.value.forEach((item) => {
        if (!deduped.has(item.videoId)) deduped.set(item.videoId, item);
      });
    });
    const all = [...deduped.values()];
    const regular = all.filter((item) => !item.isShort).sort((a, b) => b.score - a.score).slice(0, 12);
    const shorts = all.filter((item) => item.isShort).sort((a, b) => b.score - a.score).slice(0, 8);
    return [...regular, ...shorts];
  }, 10 * 60 * 1000);
  return {
    items: items || [],
    mode: items?.length ? "official-channel-fallback" : "fallback-empty",
    reason
  };
};

const youtubeFeed = async (query) => {
  const fallbackYoutubeFeed = async (reason = "missing-key") => {
    const scraped = await scrapeOfficialYoutubeFeed(query, reason);
    if (scraped.items.length) return scraped;
    const fallback = JSON.parse(await readFile(path.join(root, "data", "sport-feed-youtube.json"), "utf8"));
    return {
      ...fallback,
      mode: "fallback",
      reason
    };
  };

  if (!process.env.YOUTUBE_API_KEY) {
    return fallbackYoutubeFeed("missing-key");
  }
  const key = process.env.YOUTUBE_API_KEY;
  const fetchWindow = async (hours) => {
    const publishedAfter = new Date(Date.now() - hours * 3_600_000).toISOString();
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.search = new URLSearchParams({
      part: "snippet",
      q: query || "golf U.S. Open PGA Tour LIV Golf Rory McIlroy Scottie Scheffler",
      type: "video",
      order: "date",
      maxResults: "50",
      publishedAfter,
      relevanceLanguage: "en",
      key
    }).toString();
    const search = await fetchJson(searchUrl.href);
    const ids = (search.items || []).map((item) => item.id?.videoId).filter(Boolean);
    if (!ids.length) return [];
    const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    videosUrl.search = new URLSearchParams({ part: "snippet,statistics,contentDetails", id: ids.join(","), key }).toString();
    const videos = await fetchJson(videosUrl.href);
    return (videos.items || [])
      .filter((item) => channelIsVerified(item.snippet?.channelTitle))
      .filter((item) => Number(item.statistics?.viewCount || 0) > 500)
      .filter((item) => golfStoryMatch(`${item.snippet?.title || ""} ${item.snippet?.description || ""} ${item.snippet?.channelTitle || ""}`))
      .map((item) => {
        const views = Number(item.statistics.viewCount || 0);
        const age = Math.max(0, (Date.now() - new Date(item.snippet.publishedAt).getTime()) / 3_600_000);
        const durationMatch = String(item.contentDetails?.duration || "").match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
        const durationSeconds = durationMatch
          ? (Number(durationMatch[1] || 0) * 3600) + (Number(durationMatch[2] || 0) * 60) + Number(durationMatch[3] || 0)
          : 0;
        const duration = durationSeconds
          ? `${Math.floor(durationSeconds / 60)}:${String(durationSeconds % 60).padStart(2, "0")}`
          : "";
        const isShort = /#shorts?\b/i.test(item.snippet.title || "") || (durationSeconds > 0 && durationSeconds <= 60);
        return {
          source: "youtube",
          videoId: item.id,
          title: item.snippet.title,
          channel: item.snippet.channelTitle,
          thumbnail: item.snippet.thumbnails?.maxres?.url || item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
          views,
          duration,
          isShort,
          publishedAt: item.snippet.publishedAt,
          score: views / Math.pow(age + 1, 0.8)
        };
      })
      .sort((a, b) => b.score - a.score);
  };
  try {
    const result = await cached(`youtube:${query || SPORT}`, async () => {
      const first = await fetchWindow(DEFAULT_WINDOW_HOURS);
      if (first.length >= 6) return { items: first, mode: "live" };
      const expanded = await fetchWindow(24);
      if (expanded.length >= 6) return { items: expanded, mode: "live-expanded-24h" };
      const extended = await fetchWindow(EXTENDED_WINDOW_HOURS);
      return {
        items: extended,
        mode: extended.length ? "live-expanded-48h" : "live-empty"
      };
    });
    return result || fallbackYoutubeFeed("request-failed");
  } catch (error) {
    console.warn("YouTube API request failed; using local video fallback.", error.message);
    return fallbackYoutubeFeed(error.message);
  }
};

const readJsonBody = async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

const incompleteTitleEndings = new Set([
  "a", "an", "and", "as", "at", "before", "but", "by", "during", "for",
  "from", "in", "of", "on", "or", "the", "to", "with", "after", "against"
]);

const sanitizeTitle = (value = "") => {
  const words = String(value)
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  while (words.length > 3 && incompleteTitleEndings.has(words.at(-1).toLowerCase().replace(/[^\w-]/g, ""))) {
    words.pop();
  }
  if (words.length > 3 && incompleteTitleEndings.has(words.at(-2).toLowerCase().replace(/[^\w-]/g, ""))) {
    words.splice(-2, 2);
  }
  return words.join(" ");
};

const generateTitles = async (items = []) => {
  const normalized = items.slice(0, 50).map((item) => ({
    key: String(item.key || ""),
    source: String(item.source || ""),
    author: String(item.handle || item.channel || ""),
    text: String(item.text || "").slice(0, 500),
    description: String(item.description || "").slice(0, 1500)
  }));
  const titles = Array(normalized.length).fill("");
  const missing = [];

  normalized.forEach((item, index) => {
    const cacheKey = stableHash(`${titlePromptVersion}|${item.key}|${item.source}|${item.author}|${item.text}|${item.description}`);
    const hit = titleCache.get(cacheKey);
    if (hit) {
      titles[index] = sanitizeTitle(hit);
    } else {
      missing.push({ ...item, index, cacheKey });
    }
  });

  const aiEnabled = process.env.AI_TITLES_ENABLED === "true";
  if (!missing.length || !aiEnabled || !process.env.ANTHROPIC_API_KEY) {
    return { titles, mode: missing.length ? "fallback" : "cache" };
  }

  const prompt = `Write one concise sports-news summary title for each item below.

Requirements:
- Summarize the main news development using only facts present in that item.
- Use 3-5 words. Never exceed 5 words.
- Write a complete grammatical headline with a clear subject and active verb.
- Never end with an article, conjunction, or preposition.
- Do not place a preposition in the final two words.
- Avoid fragment endings such as "in emotional" or "after".
- Make it engaging through specific, energetic verbs while remaining factual.
- Use sentence case and a factual newsroom tone.
- No clickbait, speculation, hashtags, emojis, labels, or quotation marks.
- Do not repeat the source or author unless essential to the story.
- Return only a valid JSON array of strings in the same order.

Items:
${missing.map((item, index) => `${index + 1}. [${item.source}${item.author ? ` / ${item.author}` : ""}]
Original title: ${item.text}
Content: ${item.description || item.text}`).join("\n\n")}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }]
      }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error(`Anthropic returned ${response.status}`);
    const result = await response.json();
    const text = result.content?.find((block) => block.type === "text")?.text || "[]";
    const parsed = parseJsonArray(text);
    if (!Array.isArray(parsed) || parsed.length !== missing.length) {
      throw new Error("Anthropic returned an invalid title list");
    }
    missing.forEach((item, generatedIndex) => {
      const title = sanitizeTitle(parsed[generatedIndex]);
      if (!title) return;
      titleCache.set(item.cacheKey, title);
      titles[item.index] = title;
    });
    return { titles, mode: "ai" };
  } catch (error) {
    console.warn("AI title generation skipped.", error.message);
    return { titles, mode: "fallback" };
  }
};

const parseJsonArray = (value = "") => {
  const cleaned = String(value).replace(/^```(?:json)?\s*|\s*```$/gi, "").trim();
  for (let start = cleaned.indexOf("["); start >= 0; start = cleaned.indexOf("[", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < cleaned.length; index += 1) {
      const character = cleaned[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === "[") {
        depth += 1;
      } else if (character === "]") {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(cleaned.slice(start, index + 1));
            if (Array.isArray(parsed)) return parsed;
          } catch {
            break;
          }
        }
      }
    }
  }
  return [];
};

const normalizeScoreItems = (items = []) => items.slice(0, 12).map((item, index) => ({
  id: String(item.id || `golf-status-${index + 1}`),
  status: ["live", "recent", "scheduled"].includes(item.status) ? item.status : "recent",
  badge: String(item.badge || (item.status === "live" ? "LIVE" : item.status === "scheduled" ? "NEXT" : "FINAL")).slice(0, 8),
  court: String(item.court || item.tournament || "Golf"),
  division: String(item.division || item.round || "Leaderboard"),
  playerOne: String(item.playerOne || ""),
  playerTwo: String(item.playerTwo || ""),
  seedOne: String(item.seedOne || ""),
  seedTwo: String(item.seedTwo || ""),
  sets: Array.isArray(item.sets)
    ? item.sets.slice(0, 5).map((set) => ({ p1: String(set.p1 ?? ""), p2: String(set.p2 ?? "") }))
    : [],
  point: {
    p1: String(item.point?.p1 ?? ""),
    p2: String(item.point?.p2 ?? "")
  },
  source: String(item.source || "Live web search"),
  sourceUrl: String(item.sourceUrl || "")
})).filter((item) => item.playerOne && item.playerTwo);

const fallbackScores = async (reason = "unavailable") => {
  const fallback = JSON.parse(await readFile(path.join(root, "data", "score-ticker.json"), "utf8"));
  return { ...fallback, mode: "fallback", reason };
};

const liveScoreFeed = async () => {
  if (process.env.AI_SCORES_ENABLED !== "true" || !process.env.ANTHROPIC_API_KEY) {
    return fallbackScores("disabled");
  }

  const result = await cached("anthropic:golf-live-status", async () => {
    const now = new Date().toISOString();
    const prompt = `Search the web for current or recently completed golf tournament leaderboard updates and statuses as of ${now}.
Prioritize U.S. Open, PGA TOUR, LIV Golf, DP World Tour, LPGA, major championships, tee times, withdrawals, and press-conference updates.
Use reliable current score sources such as PGA TOUR, USGA, ESPN Golf, Golf Channel, BBC Sport, Sky Sports Golf, or official tournament pages.
Return only a valid JSON array with at most 12 live, scheduled, or recently completed golf status items.
Each object must contain:
id, status ("live", "recent", or "scheduled"), badge ("LIVE", "FINAL", or start status), court, division,
playerOne, playerTwo, seedOne, seedTwo, sets (array of {"p1":"","p2":""}), point ({"p1":"","p2":""}),
source, and sourceUrl.
Use court for tournament or course, division for round/status, player fields for golfer names or headline entities.
Use sets for score/position pairs when available, such as {"p1":"-6","p2":"1st"} or {"p1":"E","p2":"T12"}.
Use badge "FINAL" for a verified completed result and "NEXT" for a verified upcoming tee time.
Do not invent players, scores, tournaments, or URLs. Include an item when its golfers and status are credible even if granular scoring is unavailable.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_SCORE_MODEL || "claude-sonnet-4-5-20250929",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }]
      }),
        signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new Error(`Anthropic score search returned ${response.status}`);
    const payload = await response.json();
    const text = payload.content?.filter((block) => block.type === "text").map((block) => block.text).join("\n") || "";
    const items = normalizeScoreItems(parseJsonArray(text));
    if (!items.length) throw new Error("Anthropic returned no usable score items");
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      refreshSeconds: 900,
      sourceLabel: "Golf live status search",
      mode: "ai-search",
      items
    };
  }, 5 * 60 * 1000);

  return result || fallbackScores("search-failed");
};

const serveStatic = async (req, res, pathname) => {
  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^[/\\]+/, "");
  const safePath = path.normalize(requestedPath);
  const parts = safePath.split(/[\\/]+/).filter(Boolean);
  const blocked = path.isAbsolute(safePath)
    || safePath.startsWith("..")
    || parts.some((part) => part.startsWith("."))
    || parts.some((part) => /^env(?:\.|$)/i.test(part))
    || /\.(?:env|local|pem|key|crt|p12|pfx)$/i.test(safePath);
  const publicAsset = safePath === "index.html"
    || safePath === "favicon.ico"
    || parts[0] === "assets"
    || (parts[0] === "data" && parts.length === 2 && path.extname(parts[1]).toLowerCase() === ".json");
  if (blocked || !publicAsset) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const fullPath = path.join(root, safePath);
  if (!fullPath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!existsSync(fullPath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(fullPath).toLowerCase();
  res.writeHead(200, { "content-type": mimeTypes[ext] || "application/octet-stream" });
  createReadStream(fullPath).pipe(res);
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/api/sport-feed") return json(res, await sportFeed());
    if (url.pathname === "/api/sport-feed-youtube") return json(res, await youtubeFeed(url.searchParams.get("q") || ""));
    if (url.pathname === "/api/score-ticker") return json(res, await liveScoreFeed());
    if (url.pathname === "/api/sport-feed-captions" && req.method === "POST") {
      const body = await readJsonBody(req);
      return json(res, await generateTitles(Array.isArray(body.items) ? body.items : []));
    }
    if (url.pathname === "/api/sport-feed-og") {
      const target = url.searchParams.get("url");
      if (!target) return json(res, { imageUrl: null }, 400);
      return json(res, await fetchOgForSource(target, url.searchParams.get("source") || "default") || { imageUrl: null });
    }
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    return json(res, { error: error.message }, 500);
  }
}).listen(port, () => {
  console.log(`ES Hub running at http://127.0.0.1:${port}`);
});
