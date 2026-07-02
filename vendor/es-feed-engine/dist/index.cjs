'use strict';
/**
 * EssentiallySports — Social Feed Engine  v1.0
 * Compiled JavaScript (CommonJS) — works in Node.js, Next.js, Express, Remix
 */

// ─── Configuration ─────────────────────────────────────────────────────────────

const CONFIG = {
  MIN_TWITTER_LIKES:   70,
  MIN_INSTAGRAM_LIKES: 100,
  MIN_REDDIT_SCORE:    50,
  MIN_YOUTUBE_VIEWS:   500,

  PRIORITY_PLAYERS: [
    ['serena williams', 'serena'],
    ['roger federer', 'federer'],
    ['novak djokovic', 'djokovic'],
    ['rafael nadal', 'nadal'],
    ['carlos alcaraz', 'alcaraz'],
    ['coco gauff', 'gauff'],
    ['jannik sinner', 'sinner'],
    ['aryna sabalenka', 'sabalenka'],
  ],

  VERIFIED_YOUTUBE_CHANNELS: [
    'wimbledon', 'atp tour', 'wta', 'espn', 'bbc sport',
    'sky sports tennis', 'sky sports', 'tennis channel', 'tennis tv',
    'us open tennis', 'roland garros', 'australian open', 'eurosport',
    'amazon prime video sport', 'bt sport', 'nbc sports', 'cbs sports',
    'the london standard', 'itf tennis', 'laver cup', 'davis cup',
    'star sports', 'sony liv', 'tennis australia', 'tennis europe',
  ],

  YOUTUBE_WINDOW_HOURS:          48,
  YOUTUBE_WINDOW_EXTENDED_HOURS: 168,
  ES_ARTICLE_INTERVAL:           4,
  REFRESH_INTERVAL_MS:           15 * 60 * 1000,
};

// ─── Feed File Parser ──────────────────────────────────────────────────────────

function parseFeedLine(line, timestamp) {
  line = line.trim();
  if (!line.startsWith('[')) return null;

  // [X 👁413k ♥2.6k] text — @handle · url
  const tw = line.match(/^\[X\s+👁([\d.]+[km]?)\s+♥([\d.]+[km]?)\]\s+(.+?)\s+—\s+@(\S+)\s+·\s+(https?:\/\/\S+)/i);
  if (tw) return { source: 'twitter', views: tw[1], likes: tw[2], text: tw[3], handle: tw[4], url: tw[5], timestamp };

  // [IG 👁42k ♥3.2k] caption — @handle · url
  const ig = line.match(/^\[IG\s+👁([\d.]+[km]?)\s+♥([\d.]+[km]?)\]\s+(.+?)\s+—\s+@(\S+)\s+·\s+(https?:\/\/\S+)/i);
  if (ig) return { source: 'instagram', views: ig[1], likes: ig[2], text: ig[3], handle: ig[4], url: ig[5], timestamp };

  // [ES] title — domain · url
  const es = line.match(/^\[ES\]\s+(.+?)\s+—\s+\S+\s+·\s+(https?:\/\/\S+)/i);
  if (es) return { source: 'es', text: es[1], url: es[2], timestamp };

  // [Reddit ▲1850·445c] title — r/subreddit · url
  const reddit = line.match(/^\[Reddit\s+▲([\d.,]+[km]?)\s*·\s*([\d.,]+[km]?)c\]\s+(.+?)\s+—\s+(r\/\S+)\s+·\s+(https?:\/\/\S+)/i);
  if (reddit) return { source: 'reddit', score: reddit[1], comments: reddit[2], text: reddit[3], subreddit: reddit[4], url: reddit[5], timestamp };

  return null;
}

function parseFeedFile(content, filename) {
  const sportMatch = filename.match(/^([a-z-]+)-news-/);
  const sport = sportMatch ? sportMatch[1].replace(/-/g, ' ') : 'sports';

  const runs = [];
  let current = null;

  for (const rawLine of content.split('\n')) {
    const header = rawLine.match(/^##\s+(.+?)\s+—\s+(.+)$/);
    if (header) {
      if (current) runs.push(current);
      current = { time: header[1], label: header[2], sport, items: [] };
      continue;
    }
    const numbered = rawLine.match(/^\d+\.\s+(.+)$/);
    if (numbered && current) {
      const parsed = parseFeedLine(numbered[1], current.time);
      if (parsed) current.items.push(parsed);
    }
  }
  if (current) runs.push(current);
  return runs;
}

// ─── YouTube API ───────────────────────────────────────────────────────────────

function isVerifiedYouTubeChannel(channelName) {
  const c = channelName.toLowerCase().trim();
  return CONFIG.VERIFIED_YOUTUBE_CHANNELS.some(v =>
    c === v || c.startsWith(v + ' ') || c.endsWith(' ' + v) || c.includes(' ' + v + ' ')
  );
}

function youtubeTrendScore(views, publishedAt) {
  const ageH = (Date.now() - new Date(publishedAt).getTime()) / 3_600_000;
  return views / Math.pow(ageH + 1, 0.8);
}

async function searchYouTubeWindow(query, hours, apiKey) {
  const after = new Date(Date.now() - hours * 3_600_000).toISOString();
  const YT = 'https://www.googleapis.com/youtube/v3';

  const searchRes = await fetch(
    `${YT}/search?part=snippet&q=${encodeURIComponent(query)}&type=video&order=date&maxResults=50&publishedAfter=${after}&key=${apiKey}`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!searchRes.ok) return [];
  const searchData = await searchRes.json();
  if (!searchData.items?.length) return [];

  const ids = searchData.items.map(i => i.id.videoId).filter(Boolean).join(',');
  const detailRes = await fetch(
    `${YT}/videos?part=snippet,statistics&id=${ids}&key=${apiKey}`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!detailRes.ok) return [];
  const detailData = await detailRes.json();

  return (detailData.items ?? [])
    .filter(v => {
      const views = parseInt(v.statistics?.viewCount ?? '0');
      return isVerifiedYouTubeChannel(v.snippet.channelTitle) && views >= CONFIG.MIN_YOUTUBE_VIEWS;
    })
    .map(v => ({
      source: 'youtube',
      videoId: v.id,
      title: v.snippet.title,
      channel: v.snippet.channelTitle,
      thumbnail:
        v.snippet.thumbnails?.maxres?.url ??
        v.snippet.thumbnails?.high?.url ??
        v.snippet.thumbnails?.medium?.url ?? '',
      views: parseInt(v.statistics.viewCount),
      publishedAt: v.snippet.publishedAt,
    }))
    .sort((a, b) => youtubeTrendScore(b.views, b.publishedAt) - youtubeTrendScore(a.views, a.publishedAt));
}

async function fetchYouTubeVideos(query, apiKey) {
  if (!apiKey) return [];
  try {
    let videos = await searchYouTubeWindow(query, CONFIG.YOUTUBE_WINDOW_HOURS, apiKey);
    if (videos.length < 5) {
      videos = await searchYouTubeWindow(query, CONFIG.YOUTUBE_WINDOW_EXTENDED_HOURS, apiKey);
    }
    return videos;
  } catch {
    return [];
  }
}

function buildYouTubeQuery(sport, feedText) {
  const lower = feedText.toLowerCase();
  const terms = [sport];
  if (lower.includes('wimbledon'))        terms.push('wimbledon 2026');
  else if (lower.includes('us open'))     terms.push('us open 2026');
  else if (lower.includes('french open')) terms.push('roland garros 2026');
  const NAMES = ['serena','sinner','djokovic','swiatek','alcaraz','sabalenka','gauff','fritz','shelton','zverev'];
  NAMES.filter(p => lower.includes(p)).slice(0, 2).forEach(p => terms.push(p));
  return terms.join(' ');
}

// ─── Twitter data pre-fetch ────────────────────────────────────────────────────

async function prefetchTweetData(items) {
  try {
    const { fetchTweet } = await import('react-tweet/api');
    await Promise.allSettled(
      items.map(async item => {
        const tweetId = item.url.match(/status\/(\d+)/)?.[1];
        if (!tweetId) return;
        try {
          const result = await fetchTweet(tweetId);
          if (result?.data) item.tweetData = result.data;
        } catch { /* silent */ }
      })
    );
  } catch {
    // react-tweet not installed — skip
  }
}

// ─── ES Article image scraper ──────────────────────────────────────────────────

async function prefetchESImages(items) {
  await Promise.allSettled(
    items.map(async item => {
      try {
        const res = await fetch(item.url, {
          headers: { 'User-Agent': 'facebookexternalhit/1.1' },
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) return;
        let html = '';
        const reader = res.body.getReader();
        while (html.length < 80_000) {
          const { done, value } = await reader.read();
          if (done) break;
          html += new TextDecoder().decode(value);
        }
        reader.cancel();

        const imgMatch =
          html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
          html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
        if (imgMatch) item.ogImage = imgMatch[1].replace(/&amp;/g, '&');

        const descMatch =
          html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
          html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i) ||
          html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
        if (descMatch) {
          item.description = descMatch[1].replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).trim();
        }
      } catch { /* silent */ }
    })
  );
}

// ─── Ranking ───────────────────────────────────────────────────────────────────

function feedItemAgeHours(item) {
  if (item.source === 'youtube') {
    return item.publishedAt ? (Date.now() - new Date(item.publishedAt).getTime()) / 3_600_000 : 999;
  }
  const ts = item.timestamp ?? '';
  const m = ts.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return 0;
  let h = parseInt(m[1]);
  const min = parseInt(m[2]);
  const pm = m[3].toUpperCase() === 'PM';
  if (pm && h !== 12) h += 12;
  if (!pm && h === 12) h = 0;
  const utcH = h + 4; // EDT = UTC-4
  const now = new Date();
  let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcH, min));
  if (d > now) d = new Date(d.getTime() - 86_400_000);
  return (Date.now() - d.getTime()) / 3_600_000;
}

function parseMetric(value = '0') {
  const raw = String(value).trim().toLowerCase().replace(/,/g, '');
  const match = raw.match(/^([\d.]+)\s*([km])?$/);
  if (!match) return 0;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return 0;
  if (match[2] === 'm') return number * 1_000_000;
  if (match[2] === 'k') return number * 1_000;
  return number;
}

function getEngagement(item) {
  if (item.source === 'youtube') return item.views ?? 0;
  const tw = item.tweetData?.favorite_count;
  if (tw != null) return tw;
  return parseMetric(item.likes ?? item.score ?? '0');
}

function getItemText(item) {
  return item.source === 'youtube' ? item.title : (item.text ?? '');
}

function playerPriorityScore(item) {
  const text = getItemText(item).toLowerCase();
  for (let i = 0; i < CONFIG.PRIORITY_PLAYERS.length; i++) {
    if (CONFIG.PRIORITY_PLAYERS[i].some(n => text.includes(n))) return CONFIG.PRIORITY_PLAYERS.length - i;
  }
  return 0;
}

function trendingScore(item) {
  const age = Math.max(feedItemAgeHours(item), 0.1);
  return (getEngagement(item) + 1) / Math.pow(age + 1, 0.7);
}

function rankScore(item) {
  const ps   = playerPriorityScore(item) * 1_000_000;
  const age  = feedItemAgeHours(item);
  const tier = age <= 1 ? 100_000 : age <= 6 ? 50_000 : age <= 24 ? 10_000 : 0;
  return ps + tier + trendingScore(item);
}

function passesEngagementThreshold(item) {
  if (item.source === 'twitter') {
    const likes = item.tweetData?.favorite_count ??
      parseMetric(item.likes ?? '0');
    return likes >= CONFIG.MIN_TWITTER_LIKES;
  }
  if (item.source === 'instagram') {
    const likes = parseMetric(item.likes ?? '0');
    return likes >= CONFIG.MIN_INSTAGRAM_LIKES;
  }
  if (item.source === 'reddit') return parseMetric(item.score ?? '0') >= CONFIG.MIN_REDDIT_SCORE;
  if (item.source === 'youtube') return item.views >= CONFIG.MIN_YOUTUBE_VIEWS;
  return true; // ES articles always pass
}

// ─── Feed merge ────────────────────────────────────────────────────────────────

function mergeFeed(runs, youtubeItems) {
  const seen = new Set();
  const allSocial = [];
  const allES = [];

  for (const run of [...runs].reverse()) {
    for (const item of run.items) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      if (!passesEngagementThreshold(item)) continue;
      if (item.source === 'es') allES.push(item);
      else allSocial.push(item);
    }
  }

  const ytPassed = youtubeItems.filter(passesEngagementThreshold);
  const nonES = [...ytPassed, ...allSocial].sort((a, b) => rankScore(b) - rankScore(a));

  const result = [];
  let esIdx = 0;
  for (let i = 0; i < nonES.length; i++) {
    result.push(nonES[i]);
    if ((i + 1) % CONFIG.ES_ARTICLE_INTERVAL === 0 && esIdx < allES.length) {
      result.push(allES[esIdx++]);
    }
  }
  while (esIdx < allES.length) result.push(allES[esIdx++]);
  return result;
}

// ─── Caption engine ────────────────────────────────────────────────────────────

const CAPTION_PLAYERS = {
  'serena williams': 'Serena', 'serena': 'Serena',
  'venus williams': 'Venus', 'venus': 'Venus',
  'novak djokovic': 'Djokovic', 'djokovic': 'Djokovic',
  'carlos alcaraz': 'Alcaraz', 'alcaraz': 'Alcaraz',
  'jannik sinner': 'Sinner', 'sinner': 'Sinner',
  'iga swiatek': 'Swiatek', 'swiatek': 'Swiatek', 'świątek': 'Swiatek',
  'aryna sabalenka': 'Sabalenka', 'sabalenka': 'Sabalenka',
  'taylor fritz': 'Fritz', 'fritz': 'Fritz',
  'ben shelton': 'Shelton', 'shelton': 'Shelton',
  'alex eala': 'Eala', 'eala': 'Eala',
  'coco gauff': 'Gauff', 'gauff': 'Gauff',
  'elena rybakina': 'Rybakina', 'rybakina': 'Rybakina',
  'alexander zverev': 'Zverev', 'zverev': 'Zverev',
  'grigor dimitrov': 'Dimitrov', 'dimitrov': 'Dimitrov',
  'otto virtanen': 'Virtanen', 'virtanen': 'Virtanen',
  'jelena ostapenko': 'Ostapenko', 'ostapenko': 'Ostapenko',
  'daniil medvedev': 'Medvedev', 'medvedev': 'Medvedev',
  'jasmine paolini': 'Paolini', 'paolini': 'Paolini',
  'emma navarro': 'Navarro', 'navarro': 'Navarro',
  'maya joint': 'Joint', 'joint': 'Joint',
  'roger federer': 'Federer', 'federer': 'Federer',
  'rafael nadal': 'Nadal', 'nadal': 'Nadal',
  'matteo berrettini': 'Berrettini', 'berrettini': 'Berrettini',
};

const CAPTION_EVENTS = [
  { keys: ['emotional','tears','crying','broke down','sobbing','weeps'],              tag: 'emotional' },
  { keys: ['historic','history','first time','first ever','first player','first filipino'], tag: 'historic' },
  { keys: ['upset','stuns','knocks out','shock loss','shock win','eliminated'],        tag: 'upset' },
  { keys: ['comeback','return','returns','came back','back on court'],                 tag: 'comeback' },
  { keys: ['retires','retirement','retired','farewell','final match'],                 tag: 'retirement' },
  { keys: ['hilarious','funny','jokes','laughing'],                                   tag: 'funny' },
  { keys: ['injury','injured','withdrew','retires hurt'],                             tag: 'injury' },
  { keys: ['five-set','5-set','thriller','epic battle','marathon match'],              tag: 'thriller' },
  { keys: ['6-0','bagel','dominant','dominates','convincing','clinical','cruises'],   tag: 'dominant' },
  { keys: ['wild card','qualifier','unseeded','underdog'],                             tag: 'underdog' },
  { keys: ['champion','title','wins','victory','def.','defeated','beats','advances'], tag: 'win' },
  { keys: ['highlights','extended highlights'],                                       tag: 'highlights' },
  { keys: ['interview','press conference','said','calls out','responds','fires back'], tag: 'quote' },
];

function pick(arr, seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h * 31) + seed.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

function extractCaptionPlayers(text) {
  const lower = text.toLowerCase();
  const found = [];
  const sorted = Object.keys(CAPTION_PLAYERS).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (lower.includes(key) && !found.includes(CAPTION_PLAYERS[key])) {
      found.push(CAPTION_PLAYERS[key]);
      if (found.length >= 2) break;
    }
  }
  return found;
}

function detectCaptionEvent(text) {
  const lower = text.toLowerCase();
  for (const { keys, tag } of CAPTION_EVENTS) {
    if (keys.some(k => lower.includes(k))) return tag;
  }
  return 'default';
}

function generateContextCaption(text, source = 'es', seed = '') {
  const players = extractCaptionPlayers(text);
  const event   = detectCaptionEvent(text);
  const p1 = players[0];
  const p2 = players[1];
  const s  = seed || text.slice(0, 20);

  if (!p1) {
    const evtFallbacks = {
      upset:      ['A result that changed the whole draw', 'The shock Wimbledon needed to wake up'],
      emotional:  ['Raw emotion that stopped everyone in their tracks', 'The human side of Wimbledon on full display'],
      historic:   ['A moment Wimbledon won\'t forget quickly', 'History being written on Centre Court'],
      comeback:   ['The return story that has everyone talking', 'Proving why they\'re still here'],
      thriller:   ['Five sets of everything Wimbledon stands for', 'The match that delivered on every promise'],
    };
    const srcFallbacks = {
      youtube:   ['Match footage that tells the full story', 'The moment captured in full by the cameras'],
      twitter:   ['Tennis Twitter can\'t stop sharing this', 'The post that broke the tennis internet'],
      instagram: ['The image that stopped everyone scrolling', 'A Wimbledon visual worth a thousand words'],
      es:        ['The deep-dive everyone\'s reading', 'EssentiallySports goes behind the headlines'],
    };
    if (evtFallbacks[event]) return pick(evtFallbacks[event], s);
    return pick(srcFallbacks[source] ?? ['A Wimbledon moment worth your time'], s);
  }

  const templates = {
    youtube: {
      emotional:  [`Watch ${p1} — the emotion says everything`, `${p1}'s reaction in full. Worth every second.`],
      historic:   [`${p1} makes history — the footage you'll replay`, `Play this back: ${p1} enters the record books`],
      upset:      [p2 ? `Watch ${p1} dismantle ${p2} in real time` : `${p1}'s shock win — play the match back`, p2 ? `How ${p1} ended ${p2}'s tournament` : `The upset nobody expected, in full`],
      comeback:   [`${p1} back at Wimbledon — the highlights speak for themselves`, `Four years in the making. ${p1}'s return in full.`],
      dominant:   [p2 ? `${p1} barely breaks a sweat against ${p2}` : `${p1} at their clinical best`],
      thriller:   [p2 ? `${p1} vs ${p2} — five sets of everything` : `${p1} survives. Just. The full thriller.`],
      highlights: [p2 ? `Every key moment from ${p1} vs ${p2}` : `${p1}'s best moments — extended highlights`],
      win:        [p2 ? `${p1} vs ${p2} — how it unfolded` : `${p1} through — and the highlights show why`],
      quote:      [`${p1} at the mic. This is worth watching.`, p2 ? `${p1} on ${p2} — the post-match presser` : `${p1} says what nobody else will`],
      default:    [`${p1} at Wimbledon — the video evidence`, p2 ? `${p1} and ${p2}: the match on tape` : `${p1}'s Wimbledon captured on camera`],
    },
    twitter: {
      emotional:  [`${p1}'s tears said what words couldn't`, `Even ${p1} couldn't hold it together at Wimbledon`],
      historic:   [`${p1} just wrote something new into tennis history`, `The tweet that confirmed: ${p1} has changed this sport`],
      upset:      [p2 ? `${p1} just derailed ${p2}'s entire tournament` : `${p1} pulls off the result of the week`, p2 ? `${p2} didn't see ${p1} coming. Nobody did.` : `The betting apps didn't see this from ${p1}`],
      comeback:   [`${p1} is back. The moment everyone was waiting for.`, `Nobody believed ${p1} would be here. They were wrong.`],
      funny:      [`${p1} reminding everyone there's life beyond tennis`, `${p1} with the moment nobody saw coming`],
      quote:      [`${p1} not holding back — exactly what we needed to hear`, p2 ? `${p1} fires back at ${p2}. This one's heating up.` : `${p1} says what everyone else was thinking`],
      dominant:   [p2 ? `${p1} made ${p2} look slow. It wasn't close.` : `${p1} on a different level`],
      win:        [p2 ? `${p1} over ${p2} — the feed exploded at this one` : `${p1} moves on and Twitter moved with them`],
      default:    [p2 ? `${p1} and ${p2} — the one everyone's retweeting` : `${p1}'s post that stopped the tennis world`, `${p1} trending. Here's why.`],
    },
    instagram: {
      emotional:  [`${p1}'s raw emotion — the image that cuts through everything`, `You don't need words when the photo is this powerful`],
      historic:   [`${p1} makes history — and the camera caught every second`, `This is the image they'll use in the history books`],
      comeback:   [`${p1} back at Wimbledon — the photo that says it all`, `One image captures what the absence meant`],
      funny:      [`${p1} off the court — and completely themselves`, `The side of ${p1} that Instagram was made for`],
      win:        [p2 ? `${p1} beats ${p2} — the victorious photo` : `${p1} wins. The Instagram proof.`],
      quote:      [p2 ? `${p1} on ${p2} — captured courtside` : `${p1}'s take, captured courtside`],
      default:    [p2 ? `${p1}–${p2}: told in pictures` : `${p1}'s Wimbledon — captured for the grid`, p2 ? `Off-court, ${p1} and ${p2} are the story` : `${p1} — the visual you'll keep coming back to`],
    },
    es: {
      emotional:  [`Behind ${p1}'s tears — the story EssentiallySports tells`, `What you didn't see during ${p1}'s emotional moment`],
      historic:   [`The significance of ${p1}'s achievement, fully explained`, `Why ${p1}'s record matters beyond the scoreboard`],
      upset:      [p2 ? `How ${p1} planned the end of ${p2}'s campaign` : `The tactical story behind ${p1}'s biggest win`],
      comeback:   [`The full journey behind ${p1}'s return to Wimbledon`, `Why ${p1}'s comeback is bigger than the match scoreline`],
      win:        [p2 ? `The match analysis: why ${p1} was always going to beat ${p2}` : `${p1}'s winning formula, broken down`],
      quote:      [p2 ? `What ${p1} said about ${p2} — and why it matters` : `${p1} speaks. EssentiallySports with the full context.`],
      dominant:   [p2 ? `${p1} vs ${p2}: inside the most one-sided match of the week` : `What ${p1}'s dominance means for the draw`],
      default:    [p2 ? `The ${p1}–${p2} story you won't find in the scoreboard` : `The deeper story behind ${p1}'s Wimbledon`],
    },
  };

  const src = templates[source] ?? templates.es;
  const evtTemplates = src[event] ?? src.default ?? [`${p1} at Wimbledon — a moment to remember`];
  return pick(evtTemplates, s);
}

// ─── Main entry point ──────────────────────────────────────────────────────────

async function buildFeed(opts) {
  const {
    feedFileContent,
    feedFileName,
    youtubeApiKey = '',
    withTweetData = true,
    withESImages  = true,
    withCaptions  = true,
  } = opts;

  const runs   = parseFeedFile(feedFileContent, feedFileName);
  const sport  = runs[0]?.sport ?? 'sports';
  const allText = runs.flatMap(r => r.items).map(i => i.text ?? '').join(' ');

  const twitterItems = runs.flatMap(r => r.items).filter(i => i.source === 'twitter');
  const esItems      = runs.flatMap(r => r.items).filter(i => i.source === 'es');

  const [youtubeItems] = await Promise.all([
    youtubeApiKey
      ? fetchYouTubeVideos(buildYouTubeQuery(sport, allText), youtubeApiKey)
      : Promise.resolve([]),
    withTweetData ? prefetchTweetData(twitterItems) : Promise.resolve(),
    withESImages  ? prefetchESImages(esItems)        : Promise.resolve(),
  ]);

  const items = mergeFeed(runs, youtubeItems);

  if (withCaptions) {
    for (const item of items) {
      if (item.editorialCaption) continue;
      const text = getItemText(item);
      const seed = item.videoId ?? item.url ?? '';
      item.editorialCaption = generateContextCaption(text, item.source, seed);
    }
  }

  return { items, sport, totalCount: items.length, lastRun: runs[runs.length - 1]?.time ?? '' };
}

// ─── Client-side auto-refresh ──────────────────────────────────────────────────

function startAutoRefresh(feedApiUrl, onNewItems, intervalMs = CONFIG.REFRESH_INTERVAL_MS) {
  const known = new Set();

  async function poll() {
    try {
      const res = await fetch(feedApiUrl);
      if (!res.ok) return;
      const data = await res.json();
      const items = data.items ?? [];
      const isFirst = known.size === 0;
      const fresh = isFirst ? items : items.filter(i => !known.has(i.videoId ?? i.url ?? ''));
      items.forEach(i => known.add(i.videoId ?? i.url ?? ''));
      if (fresh.length > 0) onNewItems(items, fresh.length);
    } catch { /* retry next interval */ }
  }

  poll();
  const id = setInterval(poll, intervalMs);
  return () => clearInterval(id);
}

// ─── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  CONFIG,
  parseFeedFile,
  fetchYouTubeVideos,
  buildYouTubeQuery,
  prefetchTweetData,
  prefetchESImages,
  passesEngagementThreshold,
  playerPriorityScore,
  trendingScore,
  rankScore,
  mergeFeed,
  generateContextCaption,
  buildFeed,
  startAutoRefresh,
};
