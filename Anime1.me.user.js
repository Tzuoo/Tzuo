// ==UserScript==
// @name         Anime1.me
// @namespace    https://anime1.me/
// @version      3.0.4
// @description  下一集快捷鍵、全螢幕、AniSkip 自動片頭片尾跳過
// @author       tzuoo
// @match        https://anime1.me/*
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @connect      api.aniskip.com
// @connect      api.jikan.moe
// @connect      www.wikidata.org
// @connect      duckduckgo.com
// @connect      html.duckduckgo.com
// @updateURL    https://raw.githubusercontent.com/tzuoo/Tzuo/main/Anime1.me.user.js
// @downloadURL  https://raw.githubusercontent.com/tzuoo/Tzuo/main/Anime1.me.user.js
// @homepageURL  https://tzuoo.github.io/Tzuo/
// ==/UserScript==

(function () {
  "use strict";

  const NEXT_TEXT = "下一集";
  const SETTINGS_TITLE = "Anime1 設定";
  const CONFIG_KEY = "anime1Config";
  const MAL_CACHE_KEY = "anime1MalCache";
  const SKIP_CACHE_KEY = "anime1AniSkipCache";
  const SKIP_ADJUST_KEY = "anime1SkipAdjustments";
  const AUTOPLAY_FLAG = "anime1ShouldAutoplay";

  const defaults = {
    nextHotkey: "n",
    fullscreenHotkey: "f",
    settingsHotkey: "ctrl+shift+n",
    skipIntro: true,
    skipOutro: true,
    autoSkip: false,
    toastCountdown: 5,
    autoNextThreshold: 15,
    autoplayAfterJump: true,
    jumpWhenEnded: false,
    countdownSeconds: 0,
  };

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch (_) { return fallback; }
  }
  function writeJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function loadConfig() { return Object.assign({}, defaults, readJson(CONFIG_KEY, {})); }
  function saveConfig(cfg) { writeJson(CONFIG_KEY, cfg); }
  let config = loadConfig();

  function loadSkipAdjust() {
    const all = readJson(SKIP_ADJUST_KEY, {});
    const item = all[getSeriesKey()] || {};
    return {
      introStartOffset: Number(item.introStartOffset) || 0,
      introEndOffset: Number(item.introEndOffset ?? (item.introKeepSeconds ? -Number(item.introKeepSeconds) : 0)) || 0,
      outroStartOffset: Number(item.outroStartOffset) || 0,
      outroEndOffset: Number(item.outroEndOffset ?? (item.outroKeepSeconds ? -Number(item.outroKeepSeconds) : 0)) || 0,
    };
  }

  function saveSkipAdjust(adjust) {
    const all = readJson(SKIP_ADJUST_KEY, {});
    const next = {
      introStartOffset: Math.max(-120, Math.min(120, Number(adjust.introStartOffset) || 0)),
      introEndOffset: Math.max(-120, Math.min(120, Number(adjust.introEndOffset) || 0)),
      outroStartOffset: Math.max(-120, Math.min(120, Number(adjust.outroStartOffset) || 0)),
      outroEndOffset: Math.max(-120, Math.min(120, Number(adjust.outroEndOffset) || 0)),
    };
    if (next.introStartOffset || next.introEndOffset || next.outroStartOffset || next.outroEndOffset) all[getSeriesKey()] = next;
    else delete all[getSeriesKey()];
    writeJson(SKIP_ADJUST_KEY, all);
  }

  function getAdjustedRange(range, video, type) {
    const adjust = loadSkipAdjust();
    const duration = Number(video?.duration);
    const max = Number.isFinite(duration) && duration > 0 ? duration : range.end;
    const startOffset = type === "intro" ? adjust.introStartOffset : adjust.outroStartOffset;
    const endOffset = type === "intro" ? adjust.introEndOffset : adjust.outroEndOffset;
    const start = Math.max(0, Math.min(max, range.start + startOffset));
    const end = Math.max(start, Math.min(max, range.end + endOffset));
    return { start, end };
  }

  function getSkipTarget(range, video, type) {
    return getAdjustedRange(range, video, type).end;
  }

  async function fetchJson(url) {
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function requestText(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          headers: { Accept: "text/html,application/xhtml+xml" },
          timeout: 12000,
          onload: res => resolve(String(res.responseText || "")),
          onerror: reject,
          ontimeout: reject,
        });
        return;
      }
      fetch(url, { credentials: "omit" }).then(res => res.text()).then(resolve, reject);
    });
  }

  function decodePercent(value) {
    if (typeof decodeURIComponent === "function") return decodeURIComponent(value);
    return String(value)
      .replace(/%7B/gi, "{").replace(/%7D/gi, "}")
      .replace(/%22/gi, '"').replace(/%3A/gi, ":")
      .replace(/%2C/gi, ",");
  }

  function getApiData() {
    const raw = document.querySelector("video[data-apireq], .video-js[data-apireq]")?.dataset?.apireq;
    if (!raw) return {};
    try { return JSON.parse(decodePercent(raw)); }
    catch (_) { return {}; }
  }

  function getSeriesKey() {
    const api = getApiData();
    if (api.c) return `cat:${api.c}`;
    const category = document.querySelector("article a[href*='/category/'], a[href*='/category/']");
    if (category) {
      try {
        const u = new URL(category.getAttribute("href"), location.origin);
        return `category:${decodeURIComponent(u.pathname.replace(/^\/category\//, "").replace(/\/$/, ""))}`;
      } catch (_) {}
    }
    return location.pathname.replace(/^\//, "").split("/")[0] || location.pathname;
  }

  function getEpisodeNumber() {
    const rawApiEp = String(getApiData().e || "");
    const apiEp = Number((rawApiEp.match(/\d+(?:\.\d+)?/) || [])[0]);
    if (Number.isFinite(apiEp) && apiEp > 0) return apiEp;
    const text = getEpisodeHeadingText();
    const m = text.match(/\[(\d+(?:\.\d+)?)\]/) || text.match(/(?:第|\s)(\d+(?:\.\d+)?)\s*(?:話|集|$)/);
    const ep = Number(m?.[1]);
    return Number.isFinite(ep) && ep > 0 ? ep : 0;
  }

  function getEpisodeHeadingText() {
    return document.querySelector("article h1")?.textContent ||
      document.querySelector("article h2")?.textContent ||
      document.querySelector("main article h1")?.textContent ||
      document.querySelector("main article h2")?.textContent ||
      document.title;
  }

  function getAnimeTitle() {
    const text = getEpisodeHeadingText();
    return text
      .replace(/\[[^\]]+\]/g, "")
      .replace(/\s*[–|-]\s*Anime1\.me.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getPageYear() {
    const date = document.querySelector("article time, time")?.textContent || "";
    const year = Number((date.match(/\b(20\d{2}|19\d{2})\b/) || [])[1]);
    return Number.isFinite(year) ? year : 0;
  }

  function normalizeTitle(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "");
  }

  function getSeasonNumber(text = getAnimeTitle()) {
    const source = String(text || "");
    const zh = source.match(/\u7b2c\s*([\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\d]+)\s*(?:\u5b63|\u671f)/);
    if (zh) {
      const map = {
        "\u4e00": 1, "\u4e8c": 2, "\u4e09": 3, "\u56db": 4, "\u4e94": 5,
        "\u516d": 6, "\u4e03": 7, "\u516b": 8, "\u4e5d": 9, "\u5341": 10,
      };
      return Number(zh[1]) || map[zh[1]] || 0;
    }
    const en = source.match(/(?:season|s)\s*(\d+)/i) || source.match(/(\d+)(?:st|nd|rd|th)\s*season/i);
    return Number(en?.[1]) || 0;
  }

  function getSearchQueries() {
    const title = getAnimeTitle();
    const strippedSeason = title
      .replace(/\s*\u7b2c\s*[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\d]+\s*(?:\u5b63|\u671f)\s*$/g, "")
      .replace(/\s*(?:Season|S)\s*\d+\s*$/i, "")
      .trim();
    const beforeColon = title.split(/[\uff1a:]/)[0].trim();
    const beforeParen = title.replace(/[\uff08(].*?[\uff09)]/g, "").trim();
    return [title, strippedSeason, beforeColon, beforeParen]
      .map(q => q.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((q, idx, arr) => arr.indexOf(q) === idx);
  }

  function scoreMalCandidate(item, query, pageYear) {
    const q = normalizeTitle(query);
    const titles = [item.title, item.title_english, item.title_japanese, ...(item.title_synonyms || [])]
      .filter(Boolean)
      .map(normalizeTitle);
    let score = 0;
    let titleMatched = false;
    if (titles.some(t => t === q)) { score += 0.75; titleMatched = true; }
    if (titles.some(t => q && (t.includes(q) || q.includes(t)))) { score += 0.35; titleMatched = true; }
    if (pageYear && Math.abs(Number(item.year || 0) - pageYear) <= 1) score += 0.2;
    if (item.type === "TV") score += 0.05;
    if (Number(item.episodes) >= getEpisodeNumber()) score += 0.05;
    const wantedSeason = getSeasonNumber();
    if (wantedSeason) {
      const haystack = [item.title, item.title_english, item.title_japanese, ...(item.title_synonyms || [])].join(" ");
      const seasonMatch =
        new RegExp(`(?:season|第|s)\\s*${wantedSeason}\\b`, "i").test(haystack) ||
        new RegExp(`${wantedSeason}(?:st|nd|rd|th)\\s*season`, "i").test(haystack);
      score += seasonMatch ? 0.45 : -0.8;
    }
    return score;
  }

  function compactCandidate(candidate) {
    return {
      id: Number(candidate.id),
      title: candidate.title || candidate.originalTitle || "",
      originalTitle: candidate.originalTitle || "",
      description: candidate.description || "",
      year: candidate.year || "",
      episodes: candidate.episodes || "",
      source: candidate.source || "",
      score: Number(candidate.score) || 0,
    };
  }

  function uniqueCandidates(candidates) {
    const seen = new Set();
    return candidates
      .filter(item => item?.id)
      .map(compactCandidate)
      .filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }

  async function searchWikidataCandidates(query) {
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=zh-tw&format=json&limit=6&origin=*`;
    const searchData = await fetchJson(searchUrl);
    const ids = (searchData?.search || []).map(item => item.id).filter(Boolean);
    if (!ids.length) return [];

    const dataUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(ids.join("|"))}&props=labels|descriptions|claims&languages=zh-tw|zh|en|ja&format=json&origin=*`;
    const entityData = await fetchJson(dataUrl);
    return Object.values(entityData?.entities || {}).map(entity => {
      const malId = entity.claims?.P4086?.[0]?.mainsnak?.datavalue?.value;
      if (!malId) return null;
      const labels = entity.labels || {};
      const descriptions = entity.descriptions || {};
      const title =
        labels["zh-tw"]?.value ||
        labels.zh?.value ||
        labels.en?.value ||
        labels.ja?.value ||
        entity.title;
      const originalTitle = labels.ja?.value || labels.en?.value || title;
      const description =
        descriptions["zh-tw"]?.value ||
        descriptions.zh?.value ||
        descriptions.en?.value ||
        "";
      const isAnime = /動畫|anime|television|season/i.test(description);
      const yearText = entity.claims?.P580?.[0]?.mainsnak?.datavalue?.value?.time || "";
      const year = Number((yearText.match(/\+(\d{4})/) || [])[1]) || "";
      return {
        id: Number(malId),
        title,
        originalTitle,
        description,
        year,
        episodes: "",
        source: "Wikidata",
        score: (isAnime ? 0.85 : 0.45) + (year && Math.abs(year - getPageYear()) <= 1 ? 0.1 : 0),
      };
    }).filter(Boolean);
  }

  async function getWikidataTitleHints(query) {
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=zh-tw&format=json&limit=6&origin=*`;
    const searchData = await fetchJson(searchUrl);
    return (searchData?.search || []).flatMap(item => [
      item.label,
      item.match?.text,
      item.display?.label?.value,
    ]).filter(Boolean);
  }

  async function searchJikanCandidates(query) {
    const url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&type=tv&limit=8`;
    const data = await fetchJson(url);
    const pageYear = getPageYear();
    return (data?.data || []).map(item => ({
      id: item.mal_id,
      title: item.title_english || item.title || "",
      originalTitle: item.title || "",
      description: item.title_japanese || "",
      year: item.year || "",
      episodes: item.episodes || "",
      source: "MAL",
      score: scoreMalCandidate(item, query, pageYear),
    }));
  }

  async function getJikanAnime(id) {
    const data = await fetchJson(`https://api.jikan.moe/v4/anime/${encodeURIComponent(id)}`);
    return data?.data || null;
  }

  async function searchWebMalCandidates(query) {
    const searches = [
      `${query} MAL anime`,
      `${query} MyAnimeList anime`,
      `${query} MAL 作品編號`,
    ];
    const ids = [];
    for (const text of searches) {
      const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(text)}`;
      const html = await requestText(url).catch(() => "");
      const re = /myanimelist\.net\/anime\/(\d+)\/([^"'&<\s]+)/ig;
      let match;
      while ((match = re.exec(html))) {
        const id = Number(match[1]);
        if (id && !ids.includes(id)) ids.push(id);
      }
      if (ids.length >= 5) break;
    }
    const pageYear = getPageYear();
    const settled = await Promise.allSettled(ids.slice(0, 5).map(getJikanAnime));
    return settled.flatMap(result => {
      if (result.status !== "fulfilled" || !result.value) return [];
      const item = result.value;
      return [{
        id: item.mal_id,
        title: item.title_english || item.title || "",
        originalTitle: item.title || "",
        description: item.title_japanese || "",
        year: item.year || "",
        episodes: item.episodes || "",
        source: "Web/MAL",
        score: scoreMalCandidate(item, query, pageYear) + 0.15,
      }];
    });
  }

  async function findMalCandidates() {
    const baseQueries = getSearchQueries();
    if (!baseQueries.length) return [];
    const hintResults = await Promise.allSettled(baseQueries.map(getWikidataTitleHints));
    const queries = [...baseQueries, ...hintResults.flatMap(result => result.status === "fulfilled" ? result.value : [])]
      .map(q => q.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((q, idx, arr) => arr.indexOf(q) === idx);
    const jobs = queries.flatMap(query => [
      searchWikidataCandidates(query),
      searchJikanCandidates(query),
      searchWebMalCandidates(query),
    ]);
    const settled = await Promise.allSettled(jobs);
    return uniqueCandidates(settled.flatMap(result => result.status === "fulfilled" ? result.value : []));
  }

  function saveMalChoice(candidate) {
    const cache = readJson(MAL_CACHE_KEY, {});
    cache[getSeriesKey()] = Object.assign(compactCandidate(candidate), {
      time: Date.now(),
      selected: true,
    });
    writeJson(MAL_CACHE_KEY, cache);
  }

  async function chooseMalCandidate(force = true) {
    const candidates = await findMalCandidates();
    if (!candidates.length) {
      alert(`找不到「${getAnimeTitle()}」的候選作品 ID。`);
      return 0;
    }
    const message = candidates.map((item, idx) =>
      `${idx + 1}. ${item.title}` +
      `${item.originalTitle && item.originalTitle !== item.title ? ` / ${item.originalTitle}` : ""}` +
      `${item.year ? ` (${item.year})` : ""}` +
      `${item.episodes ? `, ${item.episodes} 集` : ""}` +
      `\n   MAL ID: ${item.id}｜來源: ${item.source}` +
      `${item.description ? `｜${item.description}` : ""}`
    ).join("\n\n");
    const current = readJson(MAL_CACHE_KEY, {})[getSeriesKey()]?.id;
    const picked = prompt(
      `${force ? "請選擇" : "無法確定"}「${getAnimeTitle()}」對應的作品 ID。\n` +
      `${current ? `目前使用：${current}\n` : ""}` +
      "輸入編號即可套用到這部作品全部集數：\n\n" + message,
      "1"
    );
    if (picked == null) {
      if (!force) {
        const cache = readJson(MAL_CACHE_KEY, {});
        cache[getSeriesKey()] = { dismissedAt: Date.now(), candidates };
        writeJson(MAL_CACHE_KEY, cache);
      }
      return 0;
    }
    const idx = Number(picked) - 1;
    if (!Number.isInteger(idx) || !candidates[idx]) {
      alert("編號無效，未變更作品 ID。");
      return 0;
    }
    saveMalChoice(candidates[idx]);
    notify(`已套用 MAL ID：${candidates[idx].id}`);
    return candidates[idx].id;
  }

  async function resolveMalId() {
    const cache = readJson(MAL_CACHE_KEY, {});
    const seriesKey = getSeriesKey();
    const cached = cache[seriesKey];
    if (cached?.id && Date.now() - cached.time < 90 * 24 * 60 * 60 * 1000) return cached.id;
    if (cached?.dismissedAt && Date.now() - cached.dismissedAt < 12 * 60 * 60 * 1000) return 0;

    const candidates = await findMalCandidates();
    const best = candidates[0];
    if (best && best.score >= 0.9) {
      saveMalChoice(best);
      return best.id;
    }
    return chooseMalCandidate(false);
  }

  async function loadAniSkipRanges(duration) {
    const malId = await resolveMalId();
    const episode = getEpisodeNumber();
    if (!malId || !episode || !duration || !Number.isFinite(duration)) return [];

    const cache = readJson(SKIP_CACHE_KEY, {});
    const cacheKey = `${malId}:${episode}:${Math.round(duration)}`;
    if (cache[cacheKey] && Date.now() - cache[cacheKey].time < 7 * 24 * 60 * 60 * 1000) {
      return cache[cacheKey].ranges || [];
    }

    const params = new URLSearchParams();
    params.append("types[]", "op");
    params.append("types[]", "ed");
    params.set("episodeLength", String(duration));
    const data = await fetchJson(`https://api.aniskip.com/v2/skip-times/${malId}/${episode}?${params.toString()}`);
    const ranges = (data?.results || [])
      .map(item => ({
        type: item.skipType === "ed" ? "outro" : "intro",
        start: Number(item.interval?.startTime),
        end: Number(item.interval?.endTime),
      }))
      .filter(r => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start);

    cache[cacheKey] = { time: Date.now(), ranges };
    writeJson(SKIP_CACHE_KEY, cache);
    return ranges;
  }

  function normalizeUrl(href) {
    try { return new URL(href, location.origin).href; }
    catch (_) { return ""; }
  }

  function findNextEpisodeUrl() {
    const links = Array.from(document.querySelectorAll("a[href]"));
    const exact = links.find(a => a.textContent.trim() === NEXT_TEXT);
    if (exact) return normalizeUrl(exact.getAttribute("href"));
    const loose = links.find(a => a.textContent.trim().includes(NEXT_TEXT) || /next/i.test(a.textContent.trim()));
    return loose ? normalizeUrl(loose.getAttribute("href")) : "";
  }

  function normalizeHotkey(value) {
    return String(value || "").trim().toLowerCase()
      .replace(/\s+/g, "")
      .replace("control+", "ctrl+")
      .replace("cmd+", "meta+")
      .replace("command+", "meta+")
      .replace("option+", "alt+")
      .replace("esc", "escape");
  }

  function eventToHotkey(e) {
    const parts = [];
    if (e.ctrlKey) parts.push("ctrl");
    if (e.altKey) parts.push("alt");
    if (e.shiftKey) parts.push("shift");
    if (e.metaKey) parts.push("meta");
    let key = e.key.toLowerCase();
    if (key === " ") key = "space";
    if (!["control", "shift", "alt", "meta"].includes(key)) parts.push(key);
    return parts.join("+");
  }

  function isTypingTarget(t) {
    return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
  }

  function markAutoplayWanted() {
    if (config.autoplayAfterJump) sessionStorage.setItem(AUTOPLAY_FLAG, "1");
  }

  function notify(message, ms = 2200) {
    injectStyles();
    document.getElementById("anime1-toast")?.remove();
    const toast = document.createElement("div");
    toast.id = "anime1-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), ms);
  }

  function goToNext(nextUrl) {
    if (!nextUrl) { notify("找不到下一集"); return; }
    markAutoplayWanted();
    location.assign(nextUrl);
  }

  async function waitForVideo(ms) {
    const current = document.querySelector("video");
    if (current) return current;
    return new Promise(resolve => {
      const ob = new MutationObserver(() => {
        const v = document.querySelector("video");
        if (v) { ob.disconnect(); resolve(v); }
      });
      ob.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { ob.disconnect(); resolve(document.querySelector("video")); }, ms);
    });
  }

  async function tryAutoplayIfRequested() {
    if (sessionStorage.getItem(AUTOPLAY_FLAG) !== "1") return;
    sessionStorage.removeItem(AUTOPLAY_FLAG);
    if (!config.autoplayAfterJump) return;
    const video = await waitForVideo(12000);
    if (!video) return;
    const attempts = [
      () => document.querySelector(".vjs-big-play-button")?.click(),
      () => document.querySelector(".vjs-play-control")?.click(),
      () => video.play(),
    ];
    for (const fn of attempts) {
      try {
        const result = fn();
        if (result?.catch) await result.catch(() => {});
        if (!video.paused) return;
      } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 900));
    }
  }

  function toggleFullscreen() {
    const video = document.querySelector("video");
    const target = video ? (video.closest(".video-js") || video) : document.documentElement;
    if (!document.fullscreenElement) {
      (target.requestFullscreen || target.webkitRequestFullscreen || (() => {})).call(target);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
    }
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function injectStyles() {
    if (document.getElementById("anime1-style")) return;
    const style = document.createElement("style");
    style.id = "anime1-style";
    style.textContent = `
      #anime1-toast {
        position:fixed;left:50%;top:18px;z-index:2147483647;transform:translateX(-50%);
        max-width:calc(100vw - 28px);border-radius:8px;padding:10px 12px;
        background:rgba(25,25,25,.92);color:#fff;
        font:14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      .anime1-skip-toast {
        position:fixed;left:50%;bottom:80px;z-index:2147483647;transform:translateX(-50%);
        display:flex;align-items:center;gap:8px;border-radius:8px;padding:10px 14px;
        background:rgba(25,25,25,.92);color:#fff;
        font:14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        box-shadow:0 4px 18px rgba(0,0,0,.4);white-space:nowrap;
      }
      .anime1-skip-toast button {
        padding:3px 10px;border-radius:5px;border:none;cursor:pointer;font:inherit;font-size:13px;
      }
      .anime1-skip-toast .btn-skip { background:#1677ff;color:#fff; }
      .anime1-skip-toast .btn-dismiss { background:rgba(255,255,255,.15);color:#fff; }
      #anime1-settings-backdrop {
        position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;
        background:rgba(0,0,0,.54);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      #anime1-settings {
        width:min(460px,calc(100vw - 28px));border-radius:8px;background:#fff;color:#1f2937;
        box-shadow:0 18px 46px rgba(0,0,0,.34);overflow:hidden;
      }
      #anime1-settings header,#anime1-settings footer {
        display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;background:#f6f7f9;
      }
      #anime1-settings form { display:grid;gap:12px;padding:16px; }
      #anime1-settings label { display:grid;gap:6px;font-size:14px; }
      #anime1-settings .anime1-check { grid-template-columns:18px 1fr;align-items:center; }
      #anime1-settings input[type="text"],#anime1-settings input[type="number"] {
        min-height:36px;border:1px solid #cdd3dc;border-radius:6px;padding:6px 8px;font:inherit;
      }
      #anime1-settings button {
        min-height:34px;border:1px solid #cdd3dc;border-radius:6px;padding:6px 10px;
        background:#fff;color:#1f2937;cursor:pointer;font:inherit;
      }
      #anime1-settings button[data-primary] { border-color:#1677ff;background:#1677ff;color:#fff; }
    `;
    document.head.appendChild(style);
  }

  function showSkipToast(video, range, label, type, onSkip) {
    injectStyles();
    document.querySelector(".anime1-skip-toast")?.remove();

    const toast = document.createElement("div");
    toast.className = "anime1-skip-toast";
    const text = document.createElement("span");
    const skipBtn = document.createElement("button");
    const closeBtn = document.createElement("button");
    skipBtn.className = "btn-skip";
    skipBtn.textContent = "跳過";
    closeBtn.className = "btn-dismiss";
    closeBtn.textContent = "不跳";
    toast.append(text, skipBtn, closeBtn);
    document.body.appendChild(toast);

    let closed = false;
    function cleanup() {
      closed = true;
      clearInterval(timer);
      toast.remove();
    }
    function doSkip() {
      if (closed) return;
      cleanup();
      video.currentTime = getSkipTarget(range, video, type);
      if (onSkip) onSkip();
    }
    function update() {
      const adjusted = getAdjustedRange(range, video, type);
      const remain = Math.max(0, Math.ceil(adjusted.start - video.currentTime));
      text.textContent = remain > 0
        ? `${label}，${remain}s 後跳過`
        : `${label}`;
      if (video.currentTime >= adjusted.start - 0.05) doSkip();
      if (video.currentTime >= adjusted.end || video.paused) cleanup();
    }

    skipBtn.addEventListener("click", doSkip);
    closeBtn.addEventListener("click", cleanup);
    const timer = setInterval(update, 250);
    update();
  }

  function wireSkipIntroOutro(video, nextUrl) {
    if (!video || video.dataset.anime1SkipAttached === "1") return;
    video.dataset.anime1SkipAttached = "1";

    let ranges = null;
    let loading = null;
    const state = { introWarned: false, introSkipped: false, outroWarned: false, outroSkipped: false };

    function reset() {
      ranges = null;
      loading = null;
      state.introWarned = state.introSkipped = state.outroWarned = state.outroSkipped = false;
      document.querySelector(".anime1-skip-toast")?.remove();
    }

    function ensureRanges() {
      if (ranges || loading) return;
      const dur = video.duration;
      if (!dur || !Number.isFinite(dur)) return;
      loading = loadAniSkipRanges(dur)
        .catch(() => [])
        .then(result => { ranges = result; loading = null; check(); });
    }

    function shouldGoNextNow() {
      if (!nextUrl || !video.duration || video.currentTime <= 10) return false;
      const remaining = video.duration - video.currentTime;
      return remaining > 0 && remaining <= config.autoNextThreshold;
    }

    function handleRange(type, label) {
      const range = ranges?.find(r => r.type === type);
      if (!range) return;
      const enabled = type === "intro" ? config.skipIntro : config.skipOutro;
      const warnedKey = type === "intro" ? "introWarned" : "outroWarned";
      const skippedKey = type === "intro" ? "introSkipped" : "outroSkipped";
      if (!enabled || state[skippedKey]) return;

      const t = video.currentTime;
      const adjusted = getAdjustedRange(range, video, type);
      const lead = Math.max(1, Number(config.toastCountdown) || 5);
      const inLeadWindow = t >= adjusted.start - lead && t < adjusted.end;
      const inSkipWindow = t >= adjusted.start - 0.1 && t < adjusted.end;

      if (config.autoSkip && inSkipWindow) {
        state[skippedKey] = true;
        video.currentTime = getSkipTarget(range, video, type);
        if (type === "outro") setTimeout(() => { if (shouldGoNextNow()) goToNext(nextUrl); }, 800);
        return;
      }

      if (!config.autoSkip && inLeadWindow && !state[warnedKey]) {
        state[warnedKey] = true;
        showSkipToast(video, range, label, type, type === "outro" && nextUrl ? () => {
          if (shouldGoNextNow()) goToNext(nextUrl);
        } : null);
      }
    }

    function check() {
      if (video.paused) return;
      ensureRanges();
      if (!ranges?.length) return;
      handleRange("intro", "偵測到片頭曲");
      handleRange("outro", "偵測到片尾曲");

      if (nextUrl && video.duration > 0) {
        if (shouldGoNextNow()) goToNext(nextUrl);
      }
    }

    let poll = 0;
    function start() {
      if (!poll) poll = setInterval(check, 300);
      check();
    }
    function stop() {
      clearInterval(poll);
      poll = 0;
    }

    video.addEventListener("play", start);
    video.addEventListener("playing", start);
    video.addEventListener("timeupdate", check);
    video.addEventListener("seeked", check);
    video.addEventListener("pause", stop);
    video.addEventListener("ended", stop);
    video.addEventListener("loadedmetadata", () => { reset(); check(); });
    video.addEventListener("emptied", reset);
    if (!video.paused) start();
  }

  function wireEndedJump(nextUrl) {
    let timer = 0;
    function cancelTimer() { clearTimeout(timer); timer = 0; }
    function onEnded() {
      if (!config.jumpWhenEnded || !nextUrl || timer) return;
      const delay = Math.max(0, Number(config.countdownSeconds) || 0) * 1000;
      timer = setTimeout(() => goToNext(nextUrl), delay);
    }
    function attach(v) {
      if (!v || v.dataset.anime1EndedAttached === "1") return;
      v.dataset.anime1EndedAttached = "1";
      v.addEventListener("ended", onEnded);
      v.addEventListener("play", cancelTimer);
      v.addEventListener("seeking", cancelTimer);
    }
    document.querySelectorAll("video").forEach(attach);
    new MutationObserver(() => document.querySelectorAll("video").forEach(attach))
      .observe(document.documentElement, { childList: true, subtree: true });
  }

  function wireSkipAll(nextUrl) {
    const attach = v => wireSkipIntroOutro(v, nextUrl);
    document.querySelectorAll("video").forEach(attach);
    new MutationObserver(() => document.querySelectorAll("video").forEach(attach))
      .observe(document.documentElement, { childList: true, subtree: true });
  }

  function hotkeyInput(input) {
    input.addEventListener("keydown", e => {
      e.preventDefault();
      const value = eventToHotkey(e);
      if (value) input.value = value;
    });
  }

  function mkInput(type, value, opts = {}) {
    const el = document.createElement("input");
    el.type = type;
    if (type === "checkbox") el.checked = !!value;
    else el.value = String(value);
    Object.assign(el, opts);
    return el;
  }

  function field(text, input) {
    const label = document.createElement("label");
    const span = document.createElement("span");
    span.textContent = text;
    label.append(span, input);
    return label;
  }

  function check(text, input) {
    const label = document.createElement("label");
    label.className = "anime1-check";
    const span = document.createElement("span");
    span.textContent = text;
    label.append(input, span);
    return label;
  }

  function openSettings() {
    injectStyles();
    document.getElementById("anime1-settings-backdrop")?.remove();

    const backdrop = document.createElement("div");
    backdrop.id = "anime1-settings-backdrop";
    const dialog = document.createElement("section");
    dialog.id = "anime1-settings";

    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = SETTINGS_TITLE;
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "關閉";
    close.addEventListener("click", () => backdrop.remove());
    header.append(title, close);

    const iNext = mkInput("text", config.nextHotkey); hotkeyInput(iNext);
    const iFull = mkInput("text", config.fullscreenHotkey); hotkeyInput(iFull);
    const iSettings = mkInput("text", config.settingsHotkey); hotkeyInput(iSettings);
    const iSkipIntro = mkInput("checkbox", config.skipIntro);
    const iSkipOutro = mkInput("checkbox", config.skipOutro);
    const iAutoSkip = mkInput("checkbox", config.autoSkip);
    const iToast = mkInput("number", config.toastCountdown, { min: 1, max: 30, step: 1 });
    const iAutoNext = mkInput("number", config.autoNextThreshold, { min: 0, max: 120, step: 1 });
    const iAutoplay = mkInput("checkbox", config.autoplayAfterJump);
    const iJumpEnded = mkInput("checkbox", config.jumpWhenEnded);
    const iCountdown = mkInput("number", config.countdownSeconds, { min: 0, max: 60, step: 1 });
    const adjust = loadSkipAdjust();
    const iIntroStart = mkInput("number", adjust.introStartOffset, { min: -120, max: 120, step: 0.5 });
    const iIntroEnd = mkInput("number", adjust.introEndOffset, { min: -120, max: 120, step: 0.5 });
    const iOutroStart = mkInput("number", adjust.outroStartOffset, { min: -120, max: 120, step: 0.5 });
    const iOutroEnd = mkInput("number", adjust.outroEndOffset, { min: -120, max: 120, step: 0.5 });

    const form = document.createElement("form");
    form.append(
      field("下一集快捷鍵", iNext),
      field("全螢幕快捷鍵", iFull),
      field("開啟設定快捷鍵", iSettings),
      check("啟用 AniSkip 片頭跳過", iSkipIntro),
      check("啟用 AniSkip 片尾跳過", iSkipOutro),
      check("自動跳過（不顯示提示）", iAutoSkip),
      field("提示倒數秒數", iToast),
      field("本作片頭開始偏移（秒）", iIntroStart),
      field("本作片頭結束偏移（秒）", iIntroEnd),
      field("本作片尾開始偏移（秒）", iOutroStart),
      field("本作片尾結束偏移（秒）", iOutroEnd),
      field("片尾後剩餘不足幾秒自動播下一集", iAutoNext),
      check("跳集後自動播放", iAutoplay),
      check("影片結束後自動下一集", iJumpEnded),
      field("結束後跳集倒數（秒）", iCountdown)
    );

    const footer = document.createElement("footer");
    const save = document.createElement("button");
    save.type = "button";
    save.dataset.primary = "true";
    save.textContent = "儲存";
    save.addEventListener("click", () => {
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.dispatchEvent(new Event("submit", { cancelable: true }));
    });
    footer.append(save);

    form.addEventListener("submit", e => {
      e.preventDefault();
      config = {
        nextHotkey: normalizeHotkey(iNext.value) || defaults.nextHotkey,
        fullscreenHotkey: normalizeHotkey(iFull.value) || defaults.fullscreenHotkey,
        settingsHotkey: normalizeHotkey(iSettings.value) || defaults.settingsHotkey,
        skipIntro: iSkipIntro.checked,
        skipOutro: iSkipOutro.checked,
        autoSkip: iAutoSkip.checked,
        toastCountdown: Math.max(1, Math.min(30, Number(iToast.value) || defaults.toastCountdown)),
        autoNextThreshold: Math.max(0, Math.min(120, Number(iAutoNext.value) || defaults.autoNextThreshold)),
        autoplayAfterJump: iAutoplay.checked,
        jumpWhenEnded: iJumpEnded.checked,
        countdownSeconds: Math.max(0, Math.min(60, Number(iCountdown.value) || 0)),
      };
      saveConfig(config);
      saveSkipAdjust({
        introStartOffset: iIntroStart.value,
        introEndOffset: iIntroEnd.value,
        outroStartOffset: iOutroStart.value,
        outroEndOffset: iOutroEnd.value,
      });
      backdrop.remove();
      notify("已儲存設定");
    });

    backdrop.addEventListener("click", e => { if (e.target === backdrop) backdrop.remove(); });
    dialog.append(header, form, footer);
    backdrop.append(dialog);
    document.body.append(backdrop);
    iNext.focus();
  }

  function showDebugInfo() {
    const video = document.querySelector("video");
    const malCache = readJson(MAL_CACHE_KEY, {});
    const key = getSeriesKey();
    const cached = malCache[key];
    const lines = [
      "Anime1 除錯狀態",
      "",
      `作品 key: ${key}`,
      `標題: ${getAnimeTitle() || "無"}`,
      `集數: ${getEpisodeNumber() || "無法判斷"}`,
      `自動 MAL ID: ${cached?.id || "未解析"}`,
      `MAL 標題: ${cached?.title || "無"}`,
      "",
      `video: ${video ? "有" : "無"}`,
      video ? `currentTime: ${video.currentTime}` : "",
      video ? `duration: ${video.duration}` : "",
      video ? `paused: ${video.paused}` : "",
      video ? `readyState: ${video.readyState}` : "",
      video ? `src: ${video.currentSrc || video.src || "無"}` : "",
    ].filter(line => line !== "");
    alert(lines.join("\n"));
  }

  function describeAniSkipRanges(ranges) {
    if (!ranges?.length) return ["AniSkip: 沒有資料"];
    const lines = ["AniSkip: 有資料"];
    const intro = ranges.find(r => r.type === "intro");
    const outro = ranges.find(r => r.type === "outro");
    if (intro) lines.push(`片頭: ${formatTime(intro.start)} -> ${formatTime(intro.end)}`);
    if (outro) lines.push(`片尾: ${formatTime(outro.start)} -> ${formatTime(outro.end)}`);
    return lines;
  }

  async function showCurrentMalInfo() {
    notify("正在查詢作品與 AniSkip...");
    const malId = await resolveMalId();
    const cached = readJson(MAL_CACHE_KEY, {})[getSeriesKey()];
    const video = document.querySelector("video");
    const duration = Number(video?.duration);
    const episode = getEpisodeNumber();
    const adjust = loadSkipAdjust();
    const lines = [
      "當前作品",
      "",
      `Anime1 標題: ${getAnimeTitle() || "無"}`,
      `集數: ${episode || "無法判斷"}`,
      `MAL ID: ${malId || cached?.id || "尚未選擇/解析"}`,
      `MAL 標題: ${cached?.title || "無"}`,
      `來源: ${cached?.source || "無"}`,
    ];
    if (adjust.introStartOffset) lines.push(`片頭開始偏移: ${adjust.introStartOffset} 秒`);
    if (adjust.introEndOffset) lines.push(`片頭結束偏移: ${adjust.introEndOffset} 秒`);
    if (adjust.outroStartOffset) lines.push(`片尾開始偏移: ${adjust.outroStartOffset} 秒`);
    if (adjust.outroEndOffset) lines.push(`片尾結束偏移: ${adjust.outroEndOffset} 秒`);
    lines.push("");

    if (!malId) {
      lines.push("AniSkip: 尚未取得 MAL ID");
    } else if (!episode) {
      lines.push("AniSkip: 無法判斷集數");
    } else if (!Number.isFinite(duration) || duration <= 0) {
      lines.push("AniSkip: 影片長度尚未載入，播放一下後再檢查");
    } else {
      try {
        lines.push(...describeAniSkipRanges(await loadAniSkipRanges(duration)));
      } catch (err) {
        lines.push(String(err?.message || "").includes("404") ? "AniSkip: 沒有資料" : `AniSkip: 查詢失敗 (${err.message || err})`);
      }
    }

    alert(lines.join("\n"));
  }

  function switchMalCandidate() {
    chooseMalCandidate(true).catch(err => alert(`取得候選失敗：${err.message || err}`));
  }

  function wireHotkeys(nextUrl) {
    document.addEventListener("keydown", e => {
      if (isTypingTarget(document.activeElement)) return;
      const hk = eventToHotkey(e);
      const map = [
        [config.settingsHotkey, openSettings],
        [config.nextHotkey, () => goToNext(nextUrl)],
        [config.fullscreenHotkey, toggleFullscreen],
      ];
      for (const [key, fn] of map) {
        if (hk === normalizeHotkey(key)) {
          e.preventDefault();
          fn();
          return;
        }
      }
    });
  }

  const nextUrl = findNextEpisodeUrl();
  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand(SETTINGS_TITLE, openSettings);
    GM_registerMenuCommand("顯示當前作品 ID", () => showCurrentMalInfo().catch(err => alert(`查詢失敗：${err.message || err}`)));
    GM_registerMenuCommand("選擇/切換作品 ID", switchMalCandidate);
    GM_registerMenuCommand("Anime1 除錯狀態", showDebugInfo);
  }
  wireHotkeys(nextUrl);
  wireEndedJump(nextUrl);
  wireSkipAll(nextUrl);
  tryAutoplayIfRequested();
})();
