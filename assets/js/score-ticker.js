(() => {
  "use strict";

  const ticker = document.getElementById("scoreTicker");
  if (!ticker) return;

  const endpoint = ticker.dataset.tickerEndpoint;
  const track = ticker.querySelector("[data-ticker-track]");
  const updated = ticker.querySelector("[data-ticker-updated]");
  const refreshMs = Number(ticker.dataset.refreshMs || 30000);

  const scoreRank = (value) => {
    const normalized = String(value || "").trim().toUpperCase();
    if (normalized === "AD" || normalized === "A") return 4;
    if (normalized === "40") return 3;
    if (normalized === "30") return 2;
    if (normalized === "15") return 1;
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const winningScoreIndex = (p1, p2) => {
    const first = scoreRank(p1);
    const second = scoreRank(p2);
    if (first === null || second === null || first === second) return -1;
    return first > second ? 0 : 1;
  };

  const highlightCardScores = (card) => {
    card.querySelectorAll(".score-set").forEach((set) => {
      const scores = Array.from(set.querySelectorAll("b"));
      const winner = winningScoreIndex(scores[0]?.textContent, scores[1]?.textContent);
      scores.forEach((score, index) => {
        score.classList.toggle("is-winning-score", index === winner);
        score.classList.toggle("is-losing-score", winner !== -1 && index !== winner);
      });
    });
  };

  const applyCardScoreCount = (card) => {
    const count = Math.max(1, card.querySelectorAll(".score-set").length);
    card.style.setProperty("--score-count", String(count));
    highlightCardScores(card);
  };

  const hydrateFallback = () => {
    if (!track || ticker.dataset.loaded === "true") return;
    const fallbackLoop = track.querySelector(".ticker-loop");
    if (!fallbackLoop) return;
    fallbackLoop.querySelectorAll(".ticker-card").forEach(applyCardScoreCount);
    const clone = fallbackLoop.cloneNode(true);
    clone.setAttribute("aria-hidden", "true");
    track.appendChild(clone);
    ticker.dataset.loaded = "true";
  };

  const escapeHtml = (value = "") =>
    String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]);

  const renderSeed = (seed) => seed ? `<span class="ticker-seed">${escapeHtml(seed)}</span>` : "";

  const renderMeta = (match) => `
    <span class="ticker-court">${escapeHtml(match.court)}</span>
    <span class="ticker-divider">·</span>
    <span class="ticker-division">${escapeHtml(match.division)}</span>`;

  const getScoreCount = (match) =>
    (match.sets || []).length + (match.point && (match.point.p1 || match.point.p2) ? 1 : 0);

  const renderScores = (match) => {
    const renderScorePair = (p1, p2, className = "") => {
      const winner = winningScoreIndex(p1, p2);
      return `
        <span class="score-set${className}">
          <b${winner === 0 ? ' class="is-winning-score"' : winner === 1 ? ' class="is-losing-score"' : ""}>${escapeHtml(p1)}</b>
          <b${winner === 1 ? ' class="is-winning-score"' : winner === 0 ? ' class="is-losing-score"' : ""}>${escapeHtml(p2)}</b>
        </span>`;
    };

    const setCells = (match.sets || [])
      .map((set) => renderScorePair(set.p1, set.p2))
      .join("");

    const point = match.point && (match.point.p1 || match.point.p2)
      ? renderScorePair(match.point.p1, match.point.p2, " score-point")
      : "";

    return `${setCells}${point}`;
  };

  const renderMatch = (match) => `
    <article class="ticker-card ${match.status === "live" ? "is-live" : "is-recent"}" style="--score-count: ${getScoreCount(match)}">
      <div class="ticker-status">${escapeHtml(match.badge || (match.status === "live" ? "LIVE" : "FINAL"))}</div>
      <div class="ticker-match">
        <span class="ticker-meta">${renderMeta(match)}</span>
        <div class="ticker-row">
          <span class="ticker-player">${renderSeed(match.seedOne)}${escapeHtml(match.playerOne)}</span>
        </div>
        <div class="ticker-row">
          <span class="ticker-player">${renderSeed(match.seedTwo)}${escapeHtml(match.playerTwo)}</span>
        </div>
      </div>
      <div class="ticker-score" aria-label="Set scores">${renderScores(match)}</div>
    </article>`;

  const renderTicker = (items) => {
    if (!track || !items?.length) return;
    const markup = items.map(renderMatch).join("");
    track.innerHTML = `<div class="ticker-loop">${markup}</div><div class="ticker-loop" aria-hidden="true">${markup}</div>`;
    ticker.dataset.loaded = "true";
  };

  const setUpdated = (payload) => {
    if (!updated) return;
    const date = payload?.generatedAt ? new Date(payload.generatedAt) : new Date();
    updated.textContent = `Score data refreshed ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  };

  const loadTicker = async () => {
    if (!endpoint) return;
    try {
      const response = await fetch(`${endpoint}${endpoint.includes("?") ? "&" : "?"}t=${Date.now()}`, {
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`Ticker request failed: ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.items)) throw new Error("Ticker payload is missing items");
      renderTicker(payload.items);
      setUpdated(payload);
    } catch (error) {
      ticker.dataset.error = "true";
      console.warn("Score ticker refresh failed.", error);
    }
  };

  hydrateFallback();
  loadTicker();
  window.setInterval(loadTicker, refreshMs);
})();
