(() => {
  "use strict";

  const feed = document.getElementById("socialFeed");
  if (!feed) return;

  const platformMeta = {
    instagram: { icon: "assets/app-icons/instagram.svg", name: "Instagram" },
    twitter: { icon: "assets/app-icons/x.svg", name: "X" },
    youtube: { icon: "assets/app-icons/youtube.svg", name: "YouTube" },
    es: { icon: "assets/app-icons/es-logo-mark.svg", name: "EssentiallySports" },
    facebook: { icon: "assets/app-icons/facebook.svg", name: "Facebook" },
    reddit: { icon: "assets/app-icons/reddit.png", name: "Reddit" },
    threads: { icon: "assets/app-icons/threads.svg", name: "Threads" }
  };

  const sourcePriority = ["youtube", "youtubeShorts", "es", "twitter", "reddit"];
  const pollDefinitions = [
    {
      id: "mens-title-pick",
      insertAfter: 6,
      eyebrow: "Match Point",
      question: "Who is your pick to win the Wimbledon men's singles title?",
      options: [
        { id: "sinner", label: "Jannik Sinner", votes: 1842 },
        { id: "alcaraz", label: "Carlos Alcaraz", votes: 1716 },
        { id: "djokovic", label: "Novak Djokovic", votes: 904 },
        { id: "field", label: "Someone else", votes: 338 }
      ]
    },
    {
      id: "storyline-following",
      insertAfter: 14,
      eyebrow: "Trending Now",
      question: "Which Wimbledon storyline are you following most closely?",
      options: [
        { id: "title-race", label: "The men's title race", votes: 1268 },
        { id: "breakthroughs", label: "Breakthrough runs", votes: 1074 },
        { id: "british", label: "British hopes", votes: 816 },
        { id: "five-setters", label: "Five-set drama", votes: 1492 }
      ]
    }
  ];
  const playerNames = [
    ["serena williams", "Serena"],
    ["novak djokovic", "Djokovic"],
    ["jannik sinner", "Sinner"],
    ["iga swiatek", "Swiatek"],
    ["aryna sabalenka", "Sabalenka"],
    ["coco gauff", "Gauff"],
    ["alex eala", "Eala"],
    ["otto virtanen", "Virtanen"],
    ["carlos alcaraz", "Alcaraz"],
    ["taylor fritz", "Fritz"],
    ["alexander zverev", "Zverev"],
    ["elena rybakina", "Rybakina"],
    ["maya joint", "Joint"],
    ["jack draper", "Draper"]
  ];
  const feedState = {
    items: [],
    cursor: 0,
    cycle: 0,
    nextRenderIndex: 0,
    batchSize: Number(feed.dataset.infiniteBatch || 12),
    knownKeys: new Set(),
    sentinel: null,
    observer: null
  };
  const entryState = {
    requested: false,
    rawTarget: "",
    resolvedPostId: "",
    card: null,
    highlightTimer: 0,
    peekTimer: 0,
    returnTimer: 0,
    scrollFrame: 0,
    programmaticScroll: false,
    cancelled: false,
    activated: false
  };
  const shareState = {
    backdrop: null,
    dialog: null,
    url: "",
    title: "",
    trigger: null
  };
  const scrollHint = document.querySelector("[data-scroll-hint]");
  let scrollHintTimer = 0;
  let scrollHintDismissed = false;

  const escapeHtml = (value = "") =>
    String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]);

  const icon = (name) => `<svg aria-hidden="true"><use href="#icon-${name}"></use></svg>`;

  const pollStorageKey = (pollId) => `socialHubPoll:${pollId}`;

  const readPollVote = (pollId) => {
    try {
      return window.localStorage.getItem(pollStorageKey(pollId)) || "";
    } catch {
      return "";
    }
  };

  const writePollVote = (pollId, optionId) => {
    try {
      window.localStorage.setItem(pollStorageKey(pollId), optionId);
    } catch {
      // Polls remain usable when browser storage is unavailable.
    }
  };

  const cardHubUrl = (card) => {
    const target = new URL(window.location.href);
    target.search = "";
    target.hash = "";
    target.searchParams.set("post", card.dataset.postId || card.id || "");
    return target.toString();
  };

  const copyText = async (value) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  };

  const closeShareDialog = () => {
    if (!shareState.backdrop?.classList.contains("is-open")) return;
    shareState.backdrop.classList.remove("is-open");
    shareState.backdrop.setAttribute("aria-hidden", "true");
    document.body.classList.remove("share-dialog-open");
    window.setTimeout(() => {
      shareState.trigger?.focus();
      shareState.trigger = null;
    }, 180);
  };

  const shareDestination = async (channel) => {
    const url = shareState.url;
    const title = shareState.title;
    if (!url) return;

    if (channel === "twitter") {
      window.open(`https://twitter.com/intent/tweet?${new URLSearchParams({ text: title, url })}`, "_blank", "noopener,noreferrer");
      return;
    }
    if (channel === "reddit") {
      window.open(`https://www.reddit.com/submit?${new URLSearchParams({ title, url })}`, "_blank", "noopener,noreferrer");
      return;
    }

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        closeShareDialog();
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }

    await copyText(url);
    const status = shareState.dialog.querySelector(".share-dialog-status");
    status.textContent = `Link copied for ${channel === "youtube" ? "YouTube" : "Instagram"}`;
  };

  const ensureShareDialog = () => {
    if (shareState.backdrop) return shareState.backdrop;
    const backdrop = document.createElement("div");
    backdrop.className = "share-dialog-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    backdrop.innerHTML = `
      <section class="share-dialog" role="dialog" aria-modal="true" aria-labelledby="shareDialogTitle">
        <header class="share-dialog-header">
          <h2 class="share-dialog-title" id="shareDialogTitle">Share this post</h2>
          <button class="share-dialog-close" type="button" data-share-close aria-label="Close share options">${icon("close")}</button>
        </header>
        <div class="share-platforms">
          <button class="share-platform" type="button" data-share-channel="youtube">
            <img src="assets/app-icons/youtube.svg" alt="">
            <span>YouTube</span>
          </button>
          <button class="share-platform" type="button" data-share-channel="instagram">
            <img src="assets/app-icons/instagram.svg" alt="">
            <span>Instagram</span>
          </button>
          <button class="share-platform" type="button" data-share-channel="twitter">
            <img src="assets/app-icons/x.svg" alt="">
            <span>X</span>
          </button>
          <button class="share-platform" type="button" data-share-channel="reddit">
            <img src="assets/app-icons/reddit.png" alt="">
            <span>Reddit</span>
          </button>
        </div>
        <button class="share-copy-button" type="button" data-share-copy>${icon("link")}<span>Copy embed link</span></button>
        <p class="share-dialog-status" role="status" aria-live="polite"></p>
      </section>`;
    document.body.appendChild(backdrop);

    backdrop.addEventListener("click", async (event) => {
      if (event.target === backdrop || event.target.closest("[data-share-close]")) {
        closeShareDialog();
        return;
      }
      const channel = event.target.closest("[data-share-channel]")?.dataset.shareChannel;
      if (channel) {
        await shareDestination(channel);
        return;
      }
      if (event.target.closest("[data-share-copy]")) {
        await copyText(shareState.url);
        const status = backdrop.querySelector(".share-dialog-status");
        const label = backdrop.querySelector("[data-share-copy] span");
        status.textContent = "Embed link copied";
        label.textContent = "Copied";
        window.setTimeout(() => {
          label.textContent = "Copy embed link";
          status.textContent = "";
        }, 1600);
      }
    });

    backdrop.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeShareDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(backdrop.querySelectorAll("button:not([disabled])"));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    shareState.backdrop = backdrop;
    shareState.dialog = backdrop.querySelector(".share-dialog");
    return backdrop;
  };

  const openShareDialog = (card, trigger) => {
    const backdrop = ensureShareDialog();
    shareState.url = cardHubUrl(card);
    shareState.title = card.dataset.shareTitle || document.title;
    shareState.trigger = trigger;
    backdrop.querySelector(".share-dialog-status").textContent = "";
    backdrop.querySelector("[data-share-copy] span").textContent = "Copy embed link";
    backdrop.classList.add("is-open");
    backdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("share-dialog-open");
    window.requestAnimationFrame(() => backdrop.querySelector("[data-share-close]").focus());
  };

  const slugify = (value = "") =>
    String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "post";

  const stableHash = (value = "") => {
    let hash = 2166136261;
    for (const character of String(value)) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  };

  const normalizeEntryTarget = (value = "") => {
    let target = String(value).trim();
    try {
      target = decodeURIComponent(target);
    } catch {
      // Keep literal percent signs from manually assembled newsletter URLs.
    }
    return target.replace(/^#/, "").replace(/--\d+$/, "");
  };

  const readEntryTarget = () => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get("post") || params.get("card") || window.location.hash;
    entryState.rawTarget = normalizeEntryTarget(target);
    entryState.requested = Boolean(entryState.rawTarget);
  };

  const entryCandidates = (post) => [
    post.id,
    post.sourceUrl,
    post.media?.sourceUrl,
    slugify(post.sourceUrl || ""),
    slugify(post.media?.sourceUrl || "")
  ].filter(Boolean).map(normalizeEntryTarget);

  const prioritizeEntryItem = (items) => {
    if (!items.length) return items;
    if (!entryState.requested) {
      entryState.resolvedPostId = items[0].id;
      return items;
    }
    const target = entryState.rawTarget.toLowerCase();
    let index = items.findIndex((post) =>
      entryCandidates(post).some((candidate) => candidate.toLowerCase() === target)
    );

    if (index < 0) {
      index = items.findIndex((post) =>
        entryCandidates(post).some((candidate) => {
          const value = candidate.toLowerCase();
          return target.length >= 5 && (value.includes(target) || target.includes(value));
        })
      );
    }
    if (index < 0) return items;

    const prioritized = items.slice();
    const [entryPost] = prioritized.splice(index, 1);
    entryState.resolvedPostId = entryPost.id;
    prioritized.unshift(entryPost);
    return prioritized;
  };

  const compactNumber = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return value || "";
    if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1)}M`;
    if (number >= 1_000) return `${(number / 1_000).toFixed(number >= 10_000 ? 0 : 1)}K`;
    return String(number);
  };

  const firstSentence = (value = "") => {
    const match = String(value).match(/^(.+?[.!?])(?:\s|$)/);
    return (match?.[1] || value).trim();
  };

  const cleanHeadlineText = (value = "") => String(value)
    .replace(/\shttps?:\/\/\S+/g, "")
    .replace(/[#@][\w-]+/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  const incompleteHeadlineEndings = new Set([
    "a", "an", "and", "as", "at", "before", "but", "by", "during", "for",
    "from", "in", "of", "on", "or", "the", "to", "with", "after", "against"
  ]);

  const displayHeadline = (value = "") => {
    const words = cleanHeadlineText(value).split(/\s+/).filter(Boolean).slice(0, 5);
    while (words.length > 3 && incompleteHeadlineEndings.has(words.at(-1).toLowerCase().replace(/[^\w-]/g, ""))) {
      words.pop();
    }
    return words.join(" ");
  };

  const shortHeadlineFromText = (value = "") => {
    const cleaned = cleanHeadlineText(value);
    if (!cleaned) return "";
    const first = firstSentence(cleaned).replace(/[:;,-]\s*$/g, "");
    return displayHeadline(first);
  };

  const isGenericCardTitle = (value = "") => /^(a |the )?(moment|result|post|image|video|story|match|wimbledon moment|tennis moment).*(worth|watching|time|remember)|^a moment worth watching$/i
    .test(String(value).trim());

  const extractPlayers = (text = "") => {
    const lower = text.toLowerCase();
    return playerNames.filter(([needle]) => lower.includes(needle)).map(([, label]) => label);
  };

  const editorialCaption = (item) => {
    if (item.source === "es" && item.description) return firstSentence(item.description);
    const text = `${item.text || ""} ${item.title || ""}`.toLowerCase();
    const players = extractPlayers(text);
    const p1 = players[0];
    const p2 = players[1];
    const has = (...terms) => terms.some((term) => text.includes(term));

    if (has("emotional", "tears", "crying", "broke down", "sobbing")) {
      return p1 ? `${p1}'s emotion grips Centre Court` : "Raw emotion grips Centre Court";
    }
    if (has("historic", "history", "first ever", "first player", "first time")) {
      return p1 ? `${p1} makes Wimbledon history` : "Wimbledon history unfolds today";
    }
    if (has("upset", "stuns", "shock loss", "shock win", "knocks out")) {
      return p1 && p2 ? `${p1} stuns ${p2}` : "A shock result no one saw coming";
    }
    if (has("comeback", "return", "returns", "came back")) {
      return p1 ? `${p1} powers an inspired comeback` : "A stirring comeback takes shape";
    }
    if (has("hilarious", "funny", "jokes", "laughing")) {
      return p1 ? `${p1} delivers a lighter moment` : "Wimbledon finds its lighter side";
    }
    if (has("five-set", "thriller", "epic battle", "marathon")) {
      return p1 && p2 ? `${p1}-${p2} epic grips Wimbledon` : "Five-set drama grips Wimbledon";
    }
    if (has("def.", "defeated", "beats", "champion", "wins")) {
      return p1 && p2 ? `${p1} keeps the dream alive` : "A result worth watching";
    }
    return p1 ? `${p1} commands the Wimbledon spotlight` : shortHeadlineFromText(item.text || item.title);
  };

  const ageHours = (item) => {
    const source = String(item.publishedAt || item.timestamp || "").trim();
    const relative = source.match(/(\d+)\s*(minute|min|hour|hr|day)s?\s+ago/i);
    if (relative) {
      const amount = Number(relative[1]);
      const unit = relative[2].toLowerCase();
      if (unit.startsWith("m")) return amount / 60;
      if (unit.startsWith("h")) return amount;
      return amount * 24;
    }
    if (/yesterday/i.test(source)) return 24;

    if (item.publishedAt) {
      const then = new Date(item.publishedAt).getTime();
      return Number.isFinite(then) ? (Date.now() - then) / 3_600_000 : 9999;
    }

    const timestamp = item.timestamp || item.time || "";
    const match = timestamp.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return 9999;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const ampm = match[3].toUpperCase();
    if (ampm === "PM" && hour !== 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    const now = new Date();
    const dateParts = String(item.feedDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const year = dateParts ? Number(dateParts[1]) : now.getUTCFullYear();
    const month = dateParts ? Number(dateParts[2]) - 1 : now.getUTCMonth();
    const day = dateParts ? Number(dateParts[3]) : now.getUTCDate();
    let date = new Date(Date.UTC(year, month, day, hour + 4, minute));
    if (!dateParts && date > now) date = new Date(date.getTime() - 24 * 3_600_000);
    return (Date.now() - date.getTime()) / 3_600_000;
  };

  const isWithinFreshnessWindow = (item) => {
    const hours = ageHours(item);
    const source = item.source || item.platform;
    const windowHours = source === "es" ? 72 : source === "twitter" ? 8 : 15;
    return Number.isFinite(hours) && hours >= 0 && hours <= windowHours;
  };

  const postedAgeLabel = (post) => {
    const source = String(post.publishedAt || post.timestamp || "").trim();
    const relative = source.match(/(\d+)\s*(minute|min|hour|hr|day|week)s?\s+ago/i);
    if (relative) {
      const unit = relative[2].toLowerCase();
      const suffix = unit.startsWith("m")
        ? "m"
        : unit.startsWith("h")
          ? "h"
          : unit.startsWith("d")
            ? "d"
            : "w";
      return `${relative[1]}${suffix} ago`;
    }
    if (/yesterday/i.test(source)) return "1d ago";

    const hours = ageHours(post);
    if (!Number.isFinite(hours) || hours < 0 || hours >= 9999) return "";
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`;
    if (hours < 24) return `${Math.max(1, Math.round(hours))}h ago`;
    if (hours < 168) return `${Math.floor(hours / 24)}d ago`;
    return `${Math.floor(hours / 168)}w ago`;
  };

  const buildYouTubeQuery = (payload) => {
    const runs = Array.isArray(payload?.runs) ? payload.runs : [];
    const feedItems = runs.flatMap((run) => run.items || []);
    const text = feedItems.map((item) => `${item.text || ""} ${item.title || ""}`).join(" ").toLowerCase();
    const sport = runs.find((run) => run.sport)?.sport || payload?.sport || "tennis";
    const terms = [sport];
    if (text.includes("wimbledon")) terms.push("wimbledon 2026");
    else if (text.includes("us open")) terms.push("us open 2026");
    else if (text.includes("french open")) terms.push("roland garros 2026");
    else if (text.includes("australian")) terms.push("australian open 2026");
    ["serena", "sinner", "djokovic", "swiatek", "alcaraz", "sabalenka", "gauff", "fritz", "shelton", "zverev"]
      .filter((player) => text.includes(player))
      .slice(0, 2)
      .forEach((player) => terms.push(player));
    return terms.join(" ");
  };

  const endpointWithQuery = (url, query) => {
    if (!url || !query) return url;
    const target = new URL(url, window.location.href);
    target.searchParams.set("q", query);
    return `${target.pathname}${target.search}${target.hash}`;
  };

  const readEmbeddedPayload = () => {
    if (window.__SOCIAL_HUB_DATA__) return window.__SOCIAL_HUB_DATA__;
    const node = document.getElementById("socialHubStaticData");
    if (!node?.textContent) return null;
    try {
      return JSON.parse(node.textContent);
    } catch (error) {
      console.warn("Embedded social feed data is invalid.", error);
      return null;
    }
  };

  const interleaveSources = (items) => {
    const durationSeconds = (value = "") => {
      const parts = String(value).split(":").map(Number);
      if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0;
      return parts.reduce((total, part) => (total * 60) + part, 0);
    };
    const sourceBucket = (item) => {
      const source = item.source || item.platform;
      if (source !== "youtube") return source;
      return item.isShort || /\/shorts\//i.test(item.url || item.sourceUrl || "")
        || /#shorts?\b/i.test(item.title || "")
        || (durationSeconds(item.duration) > 0 && durationSeconds(item.duration) <= 60)
        ? "youtubeShorts"
        : "youtube";
    };
    const sourceBias = {
      youtube: 24,
      youtubeShorts: 21,
      es: 17,
      twitter: 13,
      reddit: 8
    };
    const engagement = (item) => {
      if ((item.source || item.platform) === "youtube") return Number(item.views || 0);
      if ((item.source || item.platform) === "twitter") {
        return Number(item.tweetData?.favorite_count || item.likes || 0)
          + (Number(item.tweetData?.retweet_count || 0) * 2)
          + Number(item.tweetData?.conversation_count || 0);
      }
      if ((item.source || item.platform) === "reddit") return Number(item.score || 0);
      return 0;
    };
    const trendRank = (item) => {
      const source = sourceBucket(item);
      const windowHours = source === "twitter" ? 8 : 15;
      const age = Math.max(0, Math.min(windowHours, ageHours(item)));
      const recency = (windowHours - age) * 4;
      const breakingBoost = source === "twitter" && age <= 1 ? 26 : 0;
      const engagementRank = Math.log10(engagement(item) + 1) * 9;
      const serverTrend = Math.log10(Number(item.trendScore || 0) + 1) * 5;
      return recency + breakingBoost + engagementRank + serverTrend + (sourceBias[source] || 0);
    };
    const grouped = new Map();
    items
      .slice()
      .forEach((item) => {
        const bucket = sourceBucket(item);
        if (!sourcePriority.includes(bucket)) return;
        if (!grouped.has(bucket)) grouped.set(bucket, []);
        grouped.get(bucket).push(item);
      });
    grouped.forEach((group) => group.sort((a, b) => trendRank(b) - trendRank(a)));

    const output = [];
    while ([...grouped.values()].some((group) => group.length)) {
      let added = false;
      sourcePriority.forEach((source) => {
        const group = grouped.get(source);
        if (!group?.length) return;
        output.push(group.shift());
        added = true;
      });
      if (!added) break;
    }
    return output;
  };

  const itemKey = (item) => item.url || item.sourceUrl || item.videoId || item.id || `${item.source}:${item.text}`;

  const sourceFallbackImage = (source) => ({
    twitter: "assets/media/wimbledon/williams-joint.jpg",
    instagram: "assets/media/wimbledon/serena-joint-ap.jpg",
    reddit: "assets/media/wimbledon/williams-joint.jpg",
    es: "assets/media/wimbledon/jack-draper.jpg"
  })[source] || "";

  const profileFallback = (source, handle = "") => {
    const key = String(handle).replace(/^@/, "").toLowerCase();
    const known = {
      thetennisletter: "assets/profile-images/sources/TheTennisLetter.jpg",
      relevanttennis: "assets/profile-images/sources/RelevantTennis.jpg",
      atptour: "assets/profile-images/sources/atptour.jpg",
      wimbledon: "assets/profile-images/wimbledon.jpg",
      essentiallysportsmedia: "assets/profile-images/es-logo.jpg",
      essentiallysports: "assets/profile-images/es-logo.jpg",
      espn: "assets/profile-images/espn.jpg"
    };
    if (known[key]) return known[key];
    return {
      youtube: "assets/profile-images/wimbledon.jpg",
      twitter: "assets/social-icons/nav-x.svg",
      instagram: "assets/app-icons/instagram.svg",
      reddit: "assets/app-icons/avatar-reddit-tennis.svg",
      es: "assets/profile-images/es-logo.jpg"
    }[source] || "assets/app-icons/es-logo-mark.svg";
  };

  const ownedActions = () => `
    <div class="owned-actions">
      <button type="button" data-owned-action="like" aria-pressed="false">${icon("heart")}<span>Like</span></button>
      <button type="button" data-owned-action="share">${icon("share")}<span>Share</span></button>
    </div>`;

  let masonryFrame = 0;

  const layoutMasonry = () => {
    window.cancelAnimationFrame(masonryFrame);
    masonryFrame = window.requestAnimationFrame(() => {
      const cards = Array.from(feed.querySelectorAll(".social-card"));
      const resetCard = (card) => {
        card.style.position = "";
        card.style.left = "";
        card.style.top = "";
        card.style.width = "";
        card.style.gridRowEnd = "";
        card.style.height = "";
      };

      if (window.innerWidth <= 760) {
        feed.classList.remove("masonry-ready");
        feed.style.height = "";
        cards.forEach(resetCard);
        return;
      }

      const styles = window.getComputedStyle(feed);
      const gap = parseFloat(styles.getPropertyValue("--feed-gap")) || 18;
      const columnCount = window.innerWidth <= 1020 ? 2 : 3;
      const feedWidth = feed.clientWidth;
      if (!feedWidth || !cards.length) return;

      const columnWidth = (feedWidth - (gap * (columnCount - 1))) / columnCount;
      const columnHeights = Array(columnCount).fill(0);
      feed.classList.add("masonry-ready");
      cards.forEach(resetCard);

      cards.forEach((card) => {
        const span = card.classList.contains("card-wide") ? Math.min(2, columnCount) : 1;
        let column = 0;
        let top = Number.POSITIVE_INFINITY;

        for (let start = 0; start <= columnCount - span; start += 1) {
          const candidateTop = Math.max(...columnHeights.slice(start, start + span));
          if (candidateTop < top) {
            top = candidateTop;
            column = start;
          }
        }

        card.style.position = "absolute";
        card.style.left = `${column * (columnWidth + gap)}px`;
        card.style.top = `${top}px`;
        card.style.width = `${(columnWidth * span) + (gap * (span - 1))}px`;
        card.style.height = "auto";

        const cardHeight = card.getBoundingClientRect().height;
        const nextTop = top + cardHeight + gap;
        for (let index = column; index < column + span; index += 1) {
          columnHeights[index] = nextTop;
        }
      });

      feed.style.height = `${Math.max(0, Math.max(...columnHeights) - gap)}px`;
    });
  };

  const bindMasonryMedia = () => {
    feed.querySelectorAll("img").forEach((image) => {
      image.addEventListener("error", () => {
        const fallback = image.dataset.fallbackSrc;
        if (fallback && image.src !== new URL(fallback, window.location.href).href) {
          image.src = fallback;
        } else if (image.closest(".media")) {
          image.closest(".media").remove();
        }
        layoutMasonry();
      }, { once: true });
      if (image.complete) return;
      image.addEventListener("load", layoutMasonry, { once: true });
    });
  };

  const updateCarouselState = (carousel) => {
    const track = carousel?.querySelector("[data-carousel-track]");
    if (!track) return;
    const slides = Array.from(track.querySelectorAll(".carousel-slide"));
    if (!slides.length) return;
    const width = Math.max(1, track.clientWidth);
    const index = Math.min(slides.length - 1, Math.max(0, Math.round(track.scrollLeft / width)));
    const count = carousel.querySelector("[data-carousel-count]");
    if (count) count.textContent = `${index + 1}/${slides.length}`;
    const prev = carousel.querySelector("[data-carousel-dir='-1']");
    const next = carousel.querySelector("[data-carousel-dir='1']");
    if (prev) prev.disabled = index <= 0;
    if (next) next.disabled = index >= slides.length - 1;
  };

  const bindCarouselMedia = () => {
    feed.querySelectorAll(".carousel-media").forEach((carousel) => {
      if (carousel.dataset.carouselBound === "true") {
        updateCarouselState(carousel);
        return;
      }
      carousel.dataset.carouselBound = "true";
      const track = carousel.querySelector("[data-carousel-track]");
      let raf = 0;
      track?.addEventListener("scroll", () => {
        window.cancelAnimationFrame(raf);
        raf = window.requestAnimationFrame(() => updateCarouselState(carousel));
      }, { passive: true });
      carousel.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        track?.scrollBy({ left: direction * (track.clientWidth || 0), behavior: "smooth" });
      });
      updateCarouselState(carousel);
    });
  };

  const renderHeader = (post) => {
    const app = platformMeta[post.platform] || {
      icon: post.appIcon,
      name: post.appName
    };
    const avatar = /essentiallysports/i.test(post.author.name || "")
      ? "assets/profile-images/es-logo.jpg"
      : post.author.avatar;
    const verified = post.author.verified
      ? '<img class="verified" src="assets/app-icons/verify.svg" alt="Verified">'
      : "";
    const appLogo = String(app.icon || "").includes("es-logo-mark.svg")
      ? ""
      : `<img class="app-logo" src="${escapeHtml(app.icon)}" alt="${escapeHtml(app.name)}">`;

    return `
      <header class="post-header">
        <img class="avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(post.author.avatarAlt)}" data-fallback-src="${escapeHtml(profileFallback(post.platform, post.author.name))}" loading="lazy">
        <div class="user-meta">
          <div class="user-line"><span>${escapeHtml(post.author.name)}</span>${verified}</div>
          <span class="subline">${escapeHtml(post.context)}</span>
        </div>
        ${appLogo}
      </header>`;
  };

  const renderCardTitle = (post) => {
    if (!post.cardTitle) return "";
    const age = postedAgeLabel(post);
    const time = age ? `<span class="card-title-kicker">${escapeHtml(age)}</span>` : "";
    return `<h2 class="card-title-slot">${time}<span class="card-title-text">${escapeHtml(displayHeadline(post.cardTitle))}</span></h2>`;
  };

  const mapSourceItemToCard = (item, index = 0) => {
    if (item.platform && item.author) return item;

    const source = item.source;
    const text = item.text || item.title || "";
    const sourceKey = item.url || item.sourceUrl || item.videoId || text;
    const base = {
      id: `${source || "feed"}-${slugify(sourceKey)}-${stableHash(sourceKey)}`,
      platform: source,
      size: "short",
      cardTitle: isGenericCardTitle(item.caption) ? editorialCaption(item) : (item.caption || editorialCaption(item)),
      text,
      title: item.title || text,
      timestamp: item.timestamp || item.publishedAt || "",
      publishedAt: item.publishedAt || "",
      feedDate: item.feedDate || "",
      sourceUrl: item.url || item.sourceUrl || ""
    };

    if (source === "youtube") {
      const watchUrl = item.url || item.sourceUrl || `https://www.youtube.com/watch?v=${item.videoId}`;
      return {
        ...base,
        platform: "youtube",
        size: index % 5 === 0 ? "wide" : "medium",
        title: item.title,
        text: item.description || "",
        timestamp: `${item.channel || "YouTube"}${item.views ? ` · ${compactNumber(item.views)} views` : ""}`,
        context: "YouTube · verified official",
        author: {
          name: item.channel || "YouTube",
          avatar: item.channelAvatar || profileFallback("youtube", item.channel),
          avatarAlt: `${item.channel || "YouTube"} profile image`,
          verified: true
        },
        media: {
          type: "video-player",
          src: item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/hq720.jpg`,
          alt: item.title || "YouTube video thumbnail",
          title: item.title || "YouTube video",
          aspect: "wide",
          duration: item.duration || "",
          sourceName: "YouTube",
          sourceUrl: watchUrl
        },
        sourceUrl: watchUrl
      };
    }

    if (source === "twitter") {
      const tweet = item.tweetData || {};
      const user = tweet.user || {};
      const tweetImage = tweet.photos?.[0]?.url || tweet.mediaDetails?.[0]?.media_url_https || item.imageUrl || "";
      const tweetImages = (tweet.photos || tweet.mediaDetails || [])
        .map((photo) => photo.url || photo.media_url_https)
        .filter(Boolean);
      const tweetVideo = tweet.video?.variants?.find((variant) => /mp4/i.test(variant.content_type || variant.type || ""))?.url;
      const media = tweetVideo
        ? {
            type: "video-file",
            src: tweetVideo,
            poster: tweet.video.poster || tweetImage,
            alt: item.text,
            aspect: "wide"
          }
        : tweetImages.length > 1
          ? {
              type: "carousel",
              items: tweetImages.slice(0, 5).map((src, imageIndex) => ({
                type: "image",
                src,
                alt: `${item.text} image ${imageIndex + 1}`,
                aspect: "wide"
              })),
              aspect: "wide",
              sourceUrl: item.url
            }
        : tweetImage
          ? {
              type: "image",
              src: tweetImage,
              alt: item.text,
              aspect: "wide",
              sourceUrl: item.url
            }
          : null;
      return {
        ...base,
        platform: "twitter",
        size: media ? "medium" : "short",
        context: `X · ${compactNumber(tweet.favorite_count)} likes`,
        author: {
          name: user.name || item.handle || "X user",
          avatar: user.profile_image_url_https || item.profileImage || profileFallback("twitter", item.handle || user.screen_name),
          avatarAlt: `${user.name || item.handle || "X user"} profile image`,
          verified: Boolean(user.verified)
        },
        handle: item.handle || user.screen_name,
        media
      };
    }

    if (source === "es") {
      return {
        ...base,
        platform: "es",
        size: "medium",
        context: "EssentiallySports · article",
        author: {
          name: "EssentiallySports",
          avatar: "assets/profile-images/es-logo.jpg",
          avatarAlt: "EssentiallySports profile image",
          verified: true
        },
        media: (item.ogImage || item.imageUrl) ? {
          type: "image",
          src: item.ogImage || item.imageUrl,
          alt: item.text,
          aspect: "wide",
          sourceUrl: item.url
        } : null,
        description: firstSentence(item.description || "")
      };
    }

    if (source === "instagram") {
      const mediaItems = Array.isArray(item.mediaItems) ? item.mediaItems : [];
      return {
        ...base,
        platform: "instagram",
        size: item.imageUrl || mediaItems.length ? "tall" : "short",
        context: `Instagram · ${item.likes || ""} likes`.trim(),
        author: {
          name: item.handle || "Instagram",
          avatar: item.profileImage || item.avatar || profileFallback("instagram", item.handle),
          avatarAlt: `${item.handle || "Instagram"} profile image`,
          verified: Boolean(item.verified)
        },
        tags: item.tags || ["Wimbledon"],
        media: mediaItems.length > 1
          ? { type: "carousel", items: mediaItems, sourceUrl: item.url, aspect: "square" }
          : mediaItems.length === 1
            ? { ...mediaItems[0], sourceUrl: item.url, aspect: mediaItems[0].aspect || "square" }
            : item.imageUrl ? {
              type: "image",
              src: item.imageUrl,
              alt: item.text,
              aspect: "square",
              sourceUrl: item.url
            } : null
      };
    }

    if (source === "reddit") {
      const mediaItems = Array.isArray(item.mediaItems) ? item.mediaItems : [];
      return {
        ...base,
        platform: "reddit",
        size: mediaItems.length ? "medium" : "short",
        context: `${item.subreddit || "r/tennis"} · ${item.score || 0} upvotes`,
        author: {
          name: item.subreddit || "r/tennis",
          avatar: item.profileImage || "assets/app-icons/avatar-reddit-tennis.svg",
          avatarAlt: "Reddit tennis avatar",
          verified: false
        },
        media: mediaItems.length > 1
          ? { type: "carousel", items: mediaItems, sourceUrl: item.url, aspect: "wide" }
          : mediaItems.length === 1
            ? { ...mediaItems[0], sourceUrl: item.url }
            : null,
        score: item.score,
        comments: item.comments
      };
    }

    return null;
  };

  const renderMedia = (media, isYouTube = false) => {
    if (!media) return "";
    if (media.type === "carousel" && Array.isArray(media.items) && media.items.length) {
      return `
      <div class="media ${escapeHtml(media.aspect || "wide")} carousel-media" tabindex="0" aria-label="Carousel post with ${media.items.length} images">
        <div class="carousel-track" data-carousel-track>
          ${media.items.map((item, index) => `
            <figure class="carousel-slide">
              <img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt || `Carousel image ${index + 1}`)}" data-fallback-src="${escapeHtml(item.fallbackSrc || "")}" loading="lazy">
            </figure>
          `).join("")}
        </div>
        <button class="carousel-control carousel-prev" type="button" data-carousel-dir="-1" aria-label="Previous image">${icon("arrow-left")}</button>
        <button class="carousel-control carousel-next" type="button" data-carousel-dir="1" aria-label="Next image">${icon("arrow-right")}</button>
        <span class="carousel-count" data-carousel-count>1/${media.items.length}</span>
      </div>`;
    }
    if (media.type === "video-player" && media.sourceUrl) {
      const duration = media.duration
        ? `<span class="video-duration">${escapeHtml(media.duration)}</span>`
        : "";
      const source = media.sourceName
        ? `<span class="video-source">${escapeHtml(media.sourceName)}</span>`
        : "";
      return `
      <div class="media ${escapeHtml(media.aspect || "wide")} video-shell ${isYouTube ? "youtube-thumb" : ""}">
        <youtube-video class="video-frame" src="${escapeHtml(media.sourceUrl)}" title="${escapeHtml(media.title || media.alt)}" controls playsinline preload="metadata"></youtube-video>
        <button class="video-preview video-cover" type="button" data-video-src="${escapeHtml(media.sourceUrl)}" data-video-title="${escapeHtml(media.title || media.alt)}" aria-label="Play ${escapeHtml(media.title || media.alt)}">
          <img src="${escapeHtml(media.src)}" alt="${escapeHtml(media.alt)}" data-fallback-src="${escapeHtml(media.fallbackSrc || sourceFallbackImage(isYouTube ? "youtube" : ""))}" loading="lazy">
          <span class="play-badge">${icon("play")}</span>
          ${duration}
          ${source}
        </button>
      </div>`;
    }
    if (media.type === "video-file" && media.src) {
      return `
      <div class="media ${escapeHtml(media.aspect || "wide")} native-video">
        <video controls preload="metadata" poster="${escapeHtml(media.poster || "")}">
          <source src="${escapeHtml(media.src)}" type="video/mp4">
        </video>
      </div>`;
    }

    const play = media.type === "video-thumbnail"
      ? `<span class="play-badge">${icon("play")}</span>`
      : "";
    const classNames = ["media", media.aspect || "wide", isYouTube ? "youtube-thumb" : ""]
      .filter(Boolean)
      .join(" ");
    return `
      <a class="${classNames}" href="${escapeHtml(media.sourceUrl)}" target="_blank" rel="noopener noreferrer">
        <img src="${escapeHtml(media.src)}" alt="${escapeHtml(media.alt)}" data-fallback-src="${escapeHtml(media.fallbackSrc || "")}" loading="lazy">
        ${play}
      </a>`;
  };

  const renderInstagram = (post) => `
    ${renderHeader(post)}
    <div class="post-body">
      ${renderMedia(post.media)}
      <div class="caption">
        <p class="post-text"><strong>${escapeHtml(post.author.name)}</strong> ${escapeHtml(post.text)}
          ${(post.tags || []).map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join(" ")}
        </p>
      </div>
    </div>
    ${ownedActions()}`;

  const renderTwitter = (post) => `
    ${renderHeader(post)}
    <div class="post-body">
      <p class="post-text">${escapeHtml(post.text).replace(/\shttps?:\/\/t\.co\/\S+/g, "")}</p>
      ${renderMedia(post.media)}
      ${post.handle ? `<p class="youtube-meta">${escapeHtml(post.handle)}</p>` : ""}
    </div>
    ${ownedActions()}`;

  const renderYouTube = (post) => `
    ${renderHeader(post)}
    <div class="post-body">
      ${renderMedia(post.media, true)}
      <div>
        <h2 class="post-title">${escapeHtml(post.title)}</h2>
        <p class="youtube-meta">${escapeHtml(post.timestamp)}</p>
        ${post.text ? `<p class="post-text">${escapeHtml(post.text)}</p>` : ""}
      </div>
    </div>
    ${ownedActions()}`;

  const renderFacebook = (post) => `
    ${renderHeader(post)}
    <div class="post-body">
      <h2 class="post-title">${escapeHtml(post.title)}</h2>
      ${renderMedia(post.media)}
    </div>
    ${ownedActions()}`;

  const renderReddit = (post) => `
    ${renderHeader(post)}
    <div class="post-body">
      ${post.score ? `<span class="update-label">${escapeHtml(post.score)} upvotes · ${escapeHtml(post.comments || 0)} comments</span>` : ""}
      ${renderMedia(post.media)}
      <h2 class="post-title">${escapeHtml(post.title)}</h2>
      <p class="post-text">${escapeHtml(post.text)}</p>
    </div>
    ${ownedActions()}`;

  const renderArticle = (post) => `
    ${renderHeader(post)}
    <div class="post-body">
      ${renderMedia(post.media)}
      <h2 class="post-title">${escapeHtml(post.title || post.text)}</h2>
      ${post.description ? `<p class="post-text"><em>${escapeHtml(post.description)}</em></p>` : ""}
      <a class="article-link" href="${escapeHtml(post.sourceUrl)}" target="_blank" rel="noopener noreferrer">Read more</a>
    </div>
    ${ownedActions()}`;

  const renderThreads = (post) => `
    ${renderHeader(post)}
    <div class="post-body">
      <p class="post-text">${escapeHtml(post.text)}</p>
      ${(post.replies || []).map((reply) => `
        <div class="thread-reply"><strong>${escapeHtml(reply.author)}:</strong> ${escapeHtml(reply.text)}</div>
      `).join("")}
    </div>
    ${ownedActions()}`;

  const renderUpdate = (post) => `
    ${renderHeader(post)}
    <div class="post-body">
      <span class="update-label">${escapeHtml(post.label)}</span>
      <h2 class="post-title">${escapeHtml(post.title)}</h2>
      <p class="post-text">${escapeHtml(post.text)}</p>
    </div>
    <div class="update-footer">
      <span>${escapeHtml(post.footer?.[0])}</span>
      <span>${escapeHtml(post.footer?.[1])}</span>
    </div>
    ${ownedActions()}`;

  const renderers = {
    instagram: renderInstagram,
    twitter: renderTwitter,
    youtube: renderYouTube,
    es: renderArticle,
    facebook: renderFacebook,
    reddit: renderReddit,
    threads: renderThreads,
    update: renderUpdate
  };

  const createCard = (post, renderIndex) => {
    const renderer = renderers[post.platform];
    if (!renderer) return null;

    const article = document.createElement("article");
    const baseId = post.id || `${post.platform}-${renderIndex}`;
    article.className = `social-card ${post.platform}-card card-${post.size}`;
    article.id = `${baseId}--${renderIndex}`;
    article.dataset.postId = baseId;
    article.dataset.platform = post.platform;
    article.dataset.sourceUrl = post.sourceUrl || post.media?.sourceUrl || "";
    article.dataset.shareTitle = post.title || post.text || post.context || post.author.name;
    if (post.isReplay) article.dataset.replay = "true";
    article.innerHTML = `${renderCardTitle(post)}${renderer(post)}`;
    return article;
  };

  const createAdCard = (renderIndex) => {
    const variants = [
      { key: "display", label: "DISPLAY AD", note: "Native in-feed placement", size: "medium" },
      { key: "video", label: "VIDEO AD", note: "16:9 sponsor slot", size: "medium" },
      { key: "newsletter", label: "NEWSLETTER AD", note: "Promo or subscription unit", size: "short" },
      { key: "sponsor", label: "SPONSORED CARD", note: "Brand story module", size: "medium" }
    ];
    const variant = variants[Math.floor(renderIndex / 4) % variants.length];
    const article = document.createElement("aside");
    article.className = `social-card ad-card ad-card-${variant.key} card-${variant.size}`;
    article.id = `ad-space-${renderIndex}`;
    article.dataset.platform = "ad";
    article.setAttribute("aria-label", `${variant.label} space`);
    article.innerHTML = `
      <div class="ad-slot">
        <span>${variant.label}</span>
        <small>${variant.note}</small>
      </div>`;
    return article;
  };

  const pollResults = (poll, selectedOption = "") => {
    const totalVotes = poll.options.reduce((total, option) =>
      total + option.votes + (option.id === selectedOption ? 1 : 0), 0);
    const results = poll.options.map((option) => {
      const votes = option.votes + (option.id === selectedOption ? 1 : 0);
      return { ...option, percentage: Math.round((votes / totalVotes) * 100) };
    });
    return { totalVotes, results };
  };

  const renderPollOptions = (poll, selectedOption = "") => {
    const { totalVotes, results } = pollResults(poll, selectedOption);
    const hasVoted = Boolean(selectedOption);
    return `
      <div class="poll-options" role="group" aria-label="${escapeHtml(poll.question)}">
        ${results.map((option) => `
          <button
            class="poll-option${option.id === selectedOption ? " is-selected" : ""}"
            type="button"
            data-poll-option="${escapeHtml(option.id)}"
            aria-pressed="${option.id === selectedOption ? "true" : "false"}"
          >
            <span class="poll-option-fill" style="--poll-result: ${hasVoted ? option.percentage : 0}%"></span>
            <span class="poll-option-marker" aria-hidden="true"></span>
            <span class="poll-option-label">${escapeHtml(option.label)}</span>
            ${hasVoted ? `<strong class="poll-option-result">${option.percentage}%</strong>` : ""}
          </button>
        `).join("")}
      </div>
      <p class="poll-meta" aria-live="polite">${compactNumber(totalVotes)} votes${hasVoted ? " · Vote recorded" : " · Tap an option to vote"}</p>`;
  };

  const createPollCard = (poll) => {
    const selectedOption = readPollVote(poll.id);
    const article = document.createElement("aside");
    article.className = "social-card poll-card card-short";
    article.id = `poll-${poll.id}`;
    article.dataset.platform = "poll";
    article.dataset.pollId = poll.id;
    article.setAttribute("aria-labelledby", `poll-question-${poll.id}`);
    article.innerHTML = `
      <header class="poll-header">
        <div>
          <span class="poll-kicker"><img src="assets/app-icons/star.svg" alt="">${escapeHtml(poll.eyebrow)}</span>
          <span class="poll-label">Fan Poll</span>
        </div>
      </header>
      <div class="poll-body">
        <h2 class="poll-question" id="poll-question-${escapeHtml(poll.id)}">${escapeHtml(poll.question)}</h2>
        <div data-poll-results>${renderPollOptions(poll, selectedOption)}</div>
      </div>`;
    return article;
  };

  const appendPollAfterPost = (fragment, renderedPostCount) => {
    const poll = pollDefinitions.find((item) => item.insertAfter === renderedPostCount);
    if (poll && !document.getElementById(`poll-${poll.id}`)) {
      fragment.appendChild(createPollCard(poll));
    }
  };

  const renderFeed = (items) => {
    const fragment = document.createDocumentFragment();

    items.forEach((post, index) => {
      const article = createCard(post, index);
      if (article) fragment.appendChild(article);
    });

    feed.replaceChildren(fragment);
    feed.dataset.rendered = "true";
    bindMasonryMedia();
    bindCarouselMedia();
    restoreOwnedActions();
    layoutMasonry();
    window.setTimeout(layoutMasonry, 250);
    window.setTimeout(layoutMasonry, 900);
    document.dispatchEvent(new CustomEvent("socialfeed:rendered", {
      detail: { count: items.length }
    }));
  };

  const appendNextBatch = (count = feedState.batchSize) => {
    if (!feedState.items.length) return;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i += 1) {
      if (feedState.cursor >= feedState.items.length) {
        feedState.observer?.disconnect();
        feedState.sentinel?.remove();
        break;
      }
      const post = {
        ...feedState.items[feedState.cursor],
        isReplay: false
      };
      const renderIndex = feedState.nextRenderIndex;
      feedState.nextRenderIndex += 1;
      const article = createCard(post, renderIndex);
      if (article) fragment.appendChild(article);
      appendPollAfterPost(fragment, renderIndex + 1);
      if ((renderIndex + 1) % 4 === 0) {
        fragment.appendChild(createAdCard(renderIndex));
      }
      feedState.cursor += 1;
    }
    feed.appendChild(fragment);
    feed.dataset.rendered = "true";
    bindMasonryMedia();
    bindCarouselMedia();
    restoreOwnedActions();
    layoutMasonry();
    window.setTimeout(layoutMasonry, 250);
    document.dispatchEvent(new CustomEvent("socialfeed:append", {
      detail: { count }
    }));
  };

  const showRefreshBanner = (count) => {
    let banner = document.querySelector(".feed-refresh-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.className = "feed-refresh-banner";
      banner.setAttribute("role", "status");
      banner.setAttribute("aria-live", "polite");
      feed.before(banner);
    }
    banner.textContent = `↑ ${count} new ${count === 1 ? "post" : "posts"} added`;
    banner.hidden = false;
    window.clearTimeout(showRefreshBanner.timeout);
    showRefreshBanner.timeout = window.setTimeout(() => {
      banner.hidden = true;
    }, 4000);
  };

  const prependFreshCards = (items) => {
    if (!items.length) return;
    const anchor = Array.from(feed.querySelectorAll(".social-card"))
      .find((card) => card.getBoundingClientRect().bottom > 0);
    const anchorTop = anchor?.getBoundingClientRect().top;
    const fragment = document.createDocumentFragment();
    items.forEach((post) => {
      const renderIndex = feedState.nextRenderIndex;
      feedState.nextRenderIndex += 1;
      const article = createCard(post, renderIndex);
      if (article) fragment.appendChild(article);
    });
    feed.prepend(fragment);
    feed.dataset.rendered = "true";
    bindMasonryMedia();
    bindCarouselMedia();
    restoreOwnedActions();
    layoutMasonry();
    window.requestAnimationFrame(() => {
      layoutMasonry();
      window.requestAnimationFrame(() => {
        if (anchor && Number.isFinite(anchorTop)) {
          window.scrollBy({ top: anchor.getBoundingClientRect().top - anchorTop, behavior: "auto" });
        }
      });
    });
    window.setTimeout(layoutMasonry, 250);
    showRefreshBanner(items.length);
    document.dispatchEvent(new CustomEvent("socialfeed:refresh", {
      detail: { count: items.length }
    }));
  };

  const setupInfiniteScroll = () => {
    if (feedState.observer) feedState.observer.disconnect();
    feedState.sentinel?.remove();
    feedState.sentinel = document.createElement("div");
    feedState.sentinel.className = "feed-sentinel";
    feedState.sentinel.setAttribute("aria-hidden", "true");
    feed.after(feedState.sentinel);

    feedState.observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        appendNextBatch();
      }
    }, { rootMargin: "900px 0px" });
    feedState.observer.observe(feedState.sentinel);
  };

  const startInfiniteFeed = (items) => {
    if (!items.length) return;
    feedState.items = prioritizeEntryItem(items);
    feedState.cursor = 0;
    feedState.cycle = 0;
    feedState.nextRenderIndex = 0;
    feed.replaceChildren();
    appendNextBatch(50);
    setupInfiniteScroll();
    window.requestAnimationFrame(activateEntryExperience);
    document.dispatchEvent(new CustomEvent("socialfeed:rendered", {
      detail: { count: feed.querySelectorAll(".social-card").length }
    }));
  };

  const bindCardActions = () => {
    feed.addEventListener("click", (event) => {
      const carouselButton = event.target.closest("[data-carousel-dir]");
      if (carouselButton) {
        const carousel = carouselButton.closest(".carousel-media");
        const track = carousel?.querySelector("[data-carousel-track]");
        if (!track) return;
        const direction = Number(carouselButton.dataset.carouselDir || 1);
        const slideWidth = track.clientWidth || carousel.clientWidth || 0;
        track.scrollBy({ left: direction * slideWidth, behavior: "smooth" });
        window.setTimeout(() => {
          updateCarouselState(carousel);
          layoutMasonry();
        }, 280);
        return;
      }

      const pollOption = event.target.closest("[data-poll-option]");
      if (pollOption) {
        const card = pollOption.closest("[data-poll-id]");
        const poll = pollDefinitions.find((item) => item.id === card?.dataset.pollId);
        if (!card || !poll) return;
        const selectedOption = pollOption.dataset.pollOption;
        writePollVote(poll.id, selectedOption);
        const results = card.querySelector("[data-poll-results]");
        if (results) results.innerHTML = renderPollOptions(poll, selectedOption);
        card.classList.remove("is-poll-animating");
        void card.offsetWidth;
        card.classList.add("is-poll-animating");
        window.setTimeout(() => card.classList.remove("is-poll-animating"), 650);
        layoutMasonry();
        return;
      }

      const videoPoster = event.target.closest("[data-video-src]");
      if (videoPoster) {
        const preparedPlayer = videoPoster.closest(".video-shell")?.querySelector("youtube-video");
        const player = preparedPlayer || document.createElement("youtube-video");
        if (!preparedPlayer) {
          player.className = videoPoster.className.replace(/\bvideo-preview\b/g, "video-frame").trim();
          player.src = videoPoster.dataset.videoSrc;
          player.title = videoPoster.dataset.videoTitle || "YouTube video player";
          player.setAttribute("controls", "");
          player.setAttribute("playsinline", "");
        }
        player.setAttribute("autoplay", "");
        player.autoplay = true;
        player.style.display = "block";
        player.style.width = "100%";
        if (preparedPlayer) {
          videoPoster.remove();
        } else {
          videoPoster.replaceWith(player);
        }
        const playAttempt = player.play?.();
        if (playAttempt?.catch) playAttempt.catch(() => {});
        layoutMasonry();
        player.addEventListener("loadcomplete", () => {
          layoutMasonry();
          if (player.paused) {
            const retry = player.play?.();
            if (retry?.catch) retry.catch(() => {});
          }
        }, { once: true });
        return;
      }

      const button = event.target.closest("[data-owned-action]");
      if (!button) return;

      const card = button.closest(".social-card");
      const action = button.dataset.ownedAction;
      if (action === "like") {
        const active = button.getAttribute("aria-pressed") !== "true";
        button.setAttribute("aria-pressed", String(active));
        button.classList.toggle("active", active);
        if (card?.dataset.postId) {
          localStorage.setItem(`socialHubLiked:${card.dataset.postId}`, String(active));
        }
        return;
      }

      if (action === "share" && card) {
        openShareDialog(card, button);
      }
    });
  };

  const hideScrollHint = () => {
    scrollHintDismissed = true;
    window.clearTimeout(scrollHintTimer);
    scrollHint?.classList.remove("is-visible");
  };

  const initScrollHint = () => {
    if (!scrollHint || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    scrollHintTimer = window.setTimeout(() => {
      if (scrollHintDismissed) return;
      scrollHint.classList.add("is-visible");
    }, 10_000);

    window.addEventListener("scroll", () => {
      if (scrollHint.classList.contains("is-visible")) hideScrollHint();
    }, { passive: true });

    scrollHint.addEventListener("click", () => {
      hideScrollHint();
      window.scrollBy({ top: Math.min(window.innerHeight * 0.72, 620), behavior: "smooth" });
    });
  };

  const restoreOwnedActions = () => {
    feed.querySelectorAll("[data-owned-action='like']").forEach((button) => {
      const card = button.closest(".social-card");
      if (!card?.dataset.postId) return;
      const active = localStorage.getItem(`socialHubLiked:${card.dataset.postId}`) === "true";
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("active", active);
    });
  };

  const upgradeFallbackActions = () => {
    feed.querySelectorAll(".social-card").forEach((card, index) => {
      card.querySelectorAll(".platform-actions, .reaction-bar, .reddit-votes").forEach((element) => {
        element.remove();
      });
      if (!card.dataset.postId) {
        card.dataset.postId = card.id || `fallback-card-${index + 1}`;
      }
      if (!card.id) card.id = card.dataset.postId;
      if (!card.dataset.shareTitle) {
        card.dataset.shareTitle = card.querySelector(".post-title, .post-text")?.textContent?.trim() || document.title;
      }
      if (!card.querySelector(".owned-actions")) {
        card.insertAdjacentHTML("beforeend", ownedActions());
      }
    });
    restoreOwnedActions();
  };

  const normalizePayload = (payload, youtubePayload) => {
    if (Array.isArray(payload?.items) && !payload.runs) {
      const merged = [];
      const seen = new Set();
      [
        ...((youtubePayload?.items || []).map((item) => ({ ...item, source: "youtube" }))),
        ...payload.items
      ].forEach((item) => {
        const key = itemKey(item);
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(item);
      });
      return interleaveSources(merged.filter(isWithinFreshnessWindow))
        .map((item, index) => mapSourceItemToCard(item, index))
        .filter(Boolean);
    }

    const feedItems = [];
    const runs = Array.isArray(payload?.runs) ? payload.runs.slice().reverse() : [];
    runs.forEach((run) => {
      (run.items || []).forEach((item) => {
        feedItems.push({
          ...item,
          timestamp: item.timestamp || run.time,
          feedDate: item.feedDate || run.date || payload.feedDate || "",
          sport: item.sport || run.sport || payload.sport
        });
      });
    });

    const youtubeItems = [
      ...((payload?.youtube?.items || payload?.youtubeItems || []).map((item) => ({ ...item, source: "youtube" }))),
      ...((youtubePayload?.items || []).map((item) => ({ ...item, source: "youtube" })))
    ];

    const deduped = [];
    const seen = new Set();
    [...youtubeItems, ...feedItems].forEach((item) => {
      const key = itemKey(item);
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(item);
    });

    return interleaveSources(deduped.filter(isWithinFreshnessWindow))
      .map((item, index) => mapSourceItemToCard(item, index))
      .filter(Boolean);
  };

  const fetchJson = async (url) => {
    if (!url) return null;
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Feed request failed: ${response.status}`);
    return response.json();
  };

  const fetchJsonWithFallback = async (url, fallbackUrl) => {
    try {
      return await fetchJson(url);
    } catch (error) {
      if (!fallbackUrl) throw error;
      return fetchJson(fallbackUrl);
    }
  };

  const applyAiTitles = async (payload, youtubePayload) => {
    const sourceItems = [
      ...((youtubePayload?.items || []).map((item) => ({ item, source: "youtube" }))),
      ...((payload?.items || []).map((item) => ({ item, source: item.source }))),
      ...((payload?.runs || []).flatMap((run) =>
        (run.items || []).map((item) => ({ item, source: item.source }))
      ))
    ];
    if (!sourceItems.length) return;

    try {
      const batches = [];
      for (let index = 0; index < sourceItems.length; index += 25) {
        batches.push(sourceItems.slice(index, index + 25));
      }
      const results = await Promise.all(batches.map(async (batch) => {
        const response = await fetch("/api/sport-feed-captions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json"
          },
          body: JSON.stringify({
            items: batch.map(({ item, source }) => ({
              key: item.url || item.sourceUrl || item.videoId || item.text || item.title,
              source,
              text: item.title || item.text || "",
              description: item.description || item.text || "",
              handle: item.handle || "",
              channel: item.channel || ""
            }))
          })
        });
        return response.ok ? response.json() : { titles: [] };
      }));
      results.forEach((result, batchIndex) => {
        (result.titles || []).forEach((title, itemIndex) => {
          const target = batches[batchIndex]?.[itemIndex];
          if (title && target) target.item.caption = title;
        });
      });
    } catch {
      // The local editorial engine remains available when AI generation is offline.
    }
  };

  const fetchFeedPayloads = async () => {
    const endpoint = feed.dataset.feedEndpoint;
    const embedded = readEmbeddedPayload();
    if (window.location.protocol === "file:" && embedded) {
      return { payload: embedded, youtubePayload: embedded.youtube || null };
    }
    if (!endpoint) return { payload: embedded, youtubePayload: embedded?.youtube || null };
    const payload = await fetchJsonWithFallback(endpoint, feed.dataset.feedFallback);
    const youtubeEndpoint = endpointWithQuery(feed.dataset.youtubeEndpoint, buildYouTubeQuery(payload));
    const youtubePayload = await fetchJsonWithFallback(youtubeEndpoint, feed.dataset.youtubeFallback).catch(() => null);
    await applyAiTitles(payload, youtubePayload);
    return { payload, youtubePayload };
  };

  const refreshFeed = async () => {
    const { payload, youtubePayload } = await fetchFeedPayloads();
    if (!payload) return;
    const items = normalizePayload(
      payload,
      youtubePayload
    );
    const fresh = items.filter((item) => {
      const key = itemKey(item);
      if (feedState.knownKeys.has(key)) return false;
      feedState.knownKeys.add(key);
      return true;
    });
    if (!fresh.length) return;
    feedState.items = interleaveSources([...fresh, ...feedState.items]).map((item, index) =>
      item.platform ? item : mapSourceItemToCard(item, index)
    ).filter(Boolean);
    feedState.cursor += fresh.length;
    prependFreshCards(fresh);
  };

  const loadFeed = async () => {
    const injectedData = readEmbeddedPayload();
    if (window.location.protocol === "file:" && injectedData) {
      startInfiniteFeed(normalizePayload(injectedData, injectedData.youtube || null));
      feedState.knownKeys = new Set(feedState.items.map(itemKey));
      return;
    }

    const endpoint = feed.dataset.feedEndpoint;
    if (!endpoint) return;

    try {
      const { payload, youtubePayload } = await fetchFeedPayloads();
      const items = normalizePayload(
        payload,
        youtubePayload
      );
      if (!items.length) throw new Error("Feed payload is missing items");
      feedState.knownKeys = new Set(items.map(itemKey));
      startInfiniteFeed(items);
    } catch (error) {
      console.warn("Using server-rendered social feed fallback.", error);
    }
  };

  const entryCardIsVisible = () => {
    const card = entryState.card;
    if (!card?.isConnected || document.visibilityState !== "visible") return false;
    const rect = card.getBoundingClientRect();
    const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    return visibleHeight >= Math.min(180, rect.height * 0.35);
  };

  const clearEntryPeekTimers = () => {
    window.clearTimeout(entryState.peekTimer);
    window.clearTimeout(entryState.returnTimer);
    window.cancelAnimationFrame(entryState.scrollFrame);
  };

  const unbindEntryCancellation = () => {
    ["pointerdown", "touchstart", "wheel"].forEach((eventName) => {
      window.removeEventListener(eventName, cancelEntryPeek);
    });
    window.removeEventListener("keydown", cancelEntryPeek);
  };

  const cancelEntryPeek = () => {
    if (entryState.cancelled) return;
    entryState.cancelled = true;
    clearEntryPeekTimers();
    unbindEntryCancellation();
    if (entryState.card) entryState.card.dataset.entryState = "cancelled";
    if (entryState.programmaticScroll) {
      entryState.programmaticScroll = false;
      window.scrollTo({ top: window.scrollY, behavior: "auto" });
    }
  };

  const animateEntryScroll = (targetY, duration, onComplete) => {
    const startY = window.scrollY;
    const distance = targetY - startY;
    const startedAt = performance.now();

    const step = (now) => {
      if (entryState.cancelled) return;
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      window.scrollTo({ top: startY + (distance * eased), behavior: "auto" });
      if (progress < 1) {
        entryState.scrollFrame = window.requestAnimationFrame(step);
      } else {
        onComplete?.();
      }
    };

    entryState.scrollFrame = window.requestAnimationFrame(step);
  };

  const performEntryPeek = () => {
    if (
      entryState.cancelled ||
      window.innerWidth > 760 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !entryCardIsVisible()
    ) {
      if (entryState.card) entryState.card.dataset.entryState = "complete";
      unbindEntryCancellation();
      return;
    }

    const cards = Array.from(feed.querySelectorAll(".social-card:not(.ad-card)"));
    const currentIndex = cards.indexOf(entryState.card);
    const nextCard = cards[currentIndex + 1];
    if (!nextCard) return;

    const origin = window.scrollY;
    const nextRect = nextCard.getBoundingClientRect();
    const previewHeight = Math.min(window.innerHeight * 0.4, nextRect.height * 0.25);
    const revealDelta = nextRect.top - (window.innerHeight - previewHeight);
    const distance = Math.min(window.innerHeight * 0.5, Math.max(72, revealDelta));

    entryState.programmaticScroll = true;
    entryState.card.dataset.entryState = "peeking";
    entryState.card.dataset.entryPeekDistance = String(Math.round(distance));
    entryState.card.dataset.entryOrigin = String(Math.round(origin));
    animateEntryScroll(origin + distance, 1200, () => {
      entryState.returnTimer = window.setTimeout(() => {
        if (entryState.cancelled) return;
        entryState.card.dataset.entryState = "returning";
        animateEntryScroll(origin, 1200, () => {
          entryState.programmaticScroll = false;
          entryState.card.dataset.entryState = "complete";
          unbindEntryCancellation();
        });
      }, 1800);
    });
  };

  const bindEntryCancellation = () => {
    ["pointerdown", "touchstart", "wheel"].forEach((eventName) => {
      window.addEventListener(eventName, cancelEntryPeek, { once: true, passive: true });
    });
    window.addEventListener("keydown", cancelEntryPeek, { once: true });
  };

  function activateEntryExperience() {
    if (!entryState.resolvedPostId || entryState.activated) return;
    const selector = `.social-card[data-post-id="${CSS.escape(entryState.resolvedPostId)}"]`;
    const card = feed.querySelector(selector);
    if (!card) return;

    entryState.activated = true;
    entryState.card = card;
    card.classList.add("is-entry-highlight");
    card.dataset.entryState = "highlighting";
    card.setAttribute("aria-current", "true");
    card.setAttribute("tabindex", "-1");

    entryState.highlightTimer = window.setTimeout(() => {
      card.classList.remove("is-entry-highlight");
    }, 6200);
  }

  readEntryTarget();
  bindCardActions();
  initScrollHint();
  upgradeFallbackActions();
  bindMasonryMedia();
  layoutMasonry();
  window.addEventListener("resize", layoutMasonry);
  loadFeed();
  window.setInterval(() => {
    refreshFeed().catch((error) => console.warn("Feed refresh skipped.", error));
  }, 2 * 60 * 1000);
})();
