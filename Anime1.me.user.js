// ==UserScript==
// @name         Anime AniSkip Helper
// @namespace    https://tzuoo.github.io/Tzuo/
// @version      4.2.5
// @description  Anime1.me 與巴哈姆特動畫瘋共用 AniSkip 片頭片尾跳過
// @author       tzuoo
// @match        https://anime1.me/*
// @match        https://ani.gamer.com.tw/*
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @connect      api.aniskip.com
// @connect      api.jikan.moe
// @connect      www.wikidata.org
// @connect      duckduckgo.com
// @connect      html.duckduckgo.com
// @connect      jacoblincool.github.io
// @connect      jacoblin.cool
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/tzuoo/Tzuo/main/Anime1.me.user.js
// @downloadURL  https://raw.githubusercontent.com/tzuoo/Tzuo/main/Anime1.me.user.js
// @homepageURL  https://tzuoo.github.io/Tzuo/
// ==/UserScript==

(function () {
  "use strict";

  const SCRIPT_PREFIX = "animeAniSkip";
  const CONFIG_KEY = `${SCRIPT_PREFIX}.config`;
  const MAL_CACHE_KEY = `${SCRIPT_PREFIX}.malCache`;
  const SKIP_CACHE_KEY = `${SCRIPT_PREFIX}.skipCache`;
  const ADJUST_KEY = `${SCRIPT_PREFIX}.adjust`;
  const AUTOPLAY_FLAG = `${SCRIPT_PREFIX}.autoplay`;
  const SKIP_NOTICE_SECONDS = 5;

  const defaults = {
    nextHotkey: "n",
    fullscreenHotkey: "f",
    settingsHotkey: "ctrl+shift+n",
    skipEnabled: true,
    autoplayAfterJump: true,
    jumpWhenEnded: false,
  };

  const adapter = getAdapter();
  if (!adapter) return;

  function localReadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function localWriteJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function storeGet(key, fallback) {
    try {
      if (typeof GM_getValue === "function") {
        const value = GM_getValue(key, undefined);
        return value === undefined ? fallback : value;
      }
    } catch (_) {}
    return localReadJson(key, fallback);
  }

  function storeSet(key, value) {
    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(key, value);
        return;
      }
    } catch (_) {}
    localWriteJson(key, value);
  }

  function loadConfig() {
    const anime1OldConfig = localReadJson("anime1Config", {});
    const saved = Object.assign({}, anime1OldConfig, storeGet(CONFIG_KEY, {}));
    const merged = Object.assign({}, defaults, saved);
    if (saved.skipEnabled === undefined) {
      merged.skipEnabled = saved.skipIntro !== false || saved.skipOutro !== false || saved.autoSkip === true;
    }
    return merged;
  }

  function saveConfig(cfg) {
    storeSet(CONFIG_KEY, cfg);
  }

  let config = loadConfig();
  let malResolvePromise = null;
  let malChoicePromise = null;
  let ageAcceptState = { key: "", count: 0, last: 0 };

  function getSeriesKey() {
    const siteKey = adapter.getSeriesKey() || normalizeTitle(adapter.getTitle()) || location.pathname;
    return `${adapter.id}:${siteKey}`;
  }

  function getSharedTitleKey() {
    const title = normalizeTitle(adapter.getTitle());
    return title ? `shared:title:${title}` : "";
  }

  function getMalCacheEntry(cache) {
    const seriesEntry = cache[getSeriesKey()];
    if (seriesEntry?.id) return seriesEntry;
    const sharedKey = getSharedTitleKey();
    if (sharedKey && cache[sharedKey]?.id) return cache[sharedKey];

    const titleKey = normalizeTitle(adapter.getTitle());
    if (!titleKey) return null;
    return Object.entries(cache).map(([key, entry]) => ({ key, entry })).find(({ key, entry }) => {
      if (!entry?.id) return false;
      if (entry.siteTitleKey === titleKey) return true;
      const keyTitle = normalizeTitle(String(key).replace(/^(anime1|gamer):(?:category|title):/i, ""));
      return keyTitle && (keyTitle === titleKey || keyTitle.includes(titleKey) || titleKey.includes(keyTitle));
    })?.entry || null;
  }

  function loadAdjust() {
    const all = storeGet(ADJUST_KEY, localReadJson("anime1SkipAdjustments", {}));
    const item = all[getSeriesKey()] || {};
    const oldIntroEnd = item.introEndOffset ?? (item.introKeepSeconds ? -Number(item.introKeepSeconds) : 0);
    const oldOutroEnd = item.outroEndOffset ?? (item.outroKeepSeconds ? -Number(item.outroKeepSeconds) : 0);
    return {
      introOffset: clampNumber(item.introOffset ?? oldIntroEnd ?? item.introStartOffset, -120, 120, 0),
      outroOffset: clampNumber(item.outroOffset ?? oldOutroEnd ?? item.outroStartOffset, -120, 120, 0),
    };
  }

  function saveAdjust(adjust) {
    const all = storeGet(ADJUST_KEY, localReadJson("anime1SkipAdjustments", {}));
    const next = {
      introOffset: clampNumber(adjust.introOffset, -120, 120, 0),
      outroOffset: clampNumber(adjust.outroOffset, -120, 120, 0),
    };
    if (next.introOffset || next.outroOffset) {
      all[getSeriesKey()] = next;
    } else {
      delete all[getSeriesKey()];
    }
    storeSet(ADJUST_KEY, all);
  }

  function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, num));
  }

  function requestText(url, accept = "text/plain,*/*") {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          headers: { Accept: accept },
          timeout: 15000,
          onload: res => {
            if (res.status >= 200 && res.status < 300) resolve(String(res.responseText || ""));
            else reject(new Error(`HTTP ${res.status}`));
          },
          onerror: reject,
          ontimeout: () => reject(new Error("HTTP timeout")),
        });
        return;
      }
      fetch(url, { credentials: "omit" })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        })
        .then(resolve, reject);
    });
  }

  async function fetchJson(url) {
    return JSON.parse(await requestText(url, "application/json,text/plain,*/*"));
  }

  function decodePercent(value) {
    try { return decodeURIComponent(value); } catch (_) { return String(value || ""); }
  }

  function normalizeTitle(text) {
    return String(text || "").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
  }

  function cleanTitle(text) {
    return String(text || "")
      .replace(/\[[^\]]+\]/g, "")
      .replace(/\s*[-–]\s*(Anime1\.me.*|巴哈姆特動畫瘋).*$/i, "")
      .replace(/\s*線上看.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseEpisodeNumber(text) {
    const source = String(text || "");
    const bracket = source.match(/\[(\d+(?:\.\d+)?)[^\]]*\]/);
    if (bracket) return Number(bracket[1]) || 0;
    const zh = source.match(/第\s*(\d+(?:\.\d+)?)\s*(?:集|話|回)/);
    if (zh) return Number(zh[1]) || 0;
    return 0;
  }

  function getSeasonNumber(text = adapter.getTitle()) {
    const source = String(text || "");
    const zh = source.match(/第\s*([一二三四五六七八九十\d]+)\s*(?:季|期)/);
    if (zh) return parseChineseNumber(zh[1]);
    const en = source.match(/(?:season|s)\s*(\d+)/i) || source.match(/(\d+)(?:st|nd|rd|th)\s*season/i);
    return Number(en?.[1]) || 0;
  }

  function parseChineseNumber(text) {
    const raw = String(text || "");
    const digit = Number(raw);
    if (Number.isFinite(digit) && digit > 0) return digit;
    const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    if (map[raw]) return map[raw];
    if (raw.includes("十")) {
      const [left, right] = raw.split("十");
      return (left ? map[left] || 0 : 1) * 10 + (right ? map[right] || 0 : 0);
    }
    return 0;
  }

  function getSeasonSearchAliases(title) {
    const season = getSeasonNumber(title);
    if (!season) return [];
    const base = String(title || "")
      .replace(/\s*第\s*[一二三四五六七八九十\d]+\s*(?:季|期)\s*$/g, "")
      .trim();
    const numericPeriod = String(title || "")
      .replace(/第\s*[一二三四五六七八九十\d]+\s*(?:季|期)/g, `第${season}期`)
      .trim();
    return [
      numericPeriod,
      base ? `${base} 第${season}期` : "",
      base ? `${base} Season ${season}` : "",
    ].filter(Boolean);
  }

  function getKnownTitleAliases(title) {
    const source = String(title || "");
    const season = getSeasonNumber(source);
    const suffix = season ? ` Season ${season}` : "";
    const aliases = [];
    if (/杖與劍|杖与剑|魔劍譚|魔剑谭|wistoria/i.test(source)) {
      aliases.push(`Wistoria${suffix}`, `Tsue to Tsurugi no Wistoria${suffix}`);
    }
    return aliases;
  }

  function getSearchQueries() {
    const title = adapter.getTitle();
    const strippedSeason = title
      .replace(/\s*第\s*[一二三四五六七八九十\d]+\s*(?:季|期)\s*$/g, "")
      .replace(/\s*(?:Season|S)\s*\d+\s*$/i, "")
      .trim();
    const beforeColon = title.split(/[：:]/)[0].trim();
    const beforeParen = title.replace(/[（(].*?[）)]/g, "").trim();
    return [...getKnownTitleAliases(title), ...getSeasonSearchAliases(title), title, strippedSeason, beforeColon, beforeParen]
      .map(q => q.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((q, idx, arr) => arr.indexOf(q) === idx);
  }

  function scoreMalCandidate(item, query) {
    const q = normalizeTitle(query);
    const titles = [
      item.title,
      item.title_english,
      item.title_japanese,
      ...(item.title_synonyms || []),
      ...((item.titles || []).map(t => t.title)),
    ].filter(Boolean);
    const normalizedTitles = titles.map(normalizeTitle);
    let score = 0;
    let titleMatched = false;

    if (normalizedTitles.some(t => t === q)) {
      score += 0.75;
      titleMatched = true;
    }
    if (normalizedTitles.some(t => q && (t.includes(q) || q.includes(t)))) {
      score += 0.35;
      titleMatched = true;
    }

    const pageYear = adapter.getPageYear();
    if (pageYear && Math.abs(Number(item.year || 0) - pageYear) <= 1) score += 0.2;
    if (item.type === "TV") score += 0.05;
    const episode = adapter.getEpisodeNumber();
    if (episode && Number(item.episodes) >= episode) score += 0.05;

    const wantedSeason = getSeasonNumber();
    if (wantedSeason) {
      const haystack = titles.join(" ");
      const seasonMatch =
        new RegExp(`(?:season|s)\\s*${wantedSeason}\\b`, "i").test(haystack) ||
        new RegExp(`${wantedSeason}(?:st|nd|rd|th)\\s*season`, "i").test(haystack) ||
        new RegExp(`第\\s*${wantedSeason}\\s*(?:季|期)`).test(haystack);
      score += seasonMatch ? 0.45 : -0.8;
    }

    if (!titleMatched && score < 0.45) score -= 0.05;
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
      const title = labels["zh-tw"]?.value || labels.zh?.value || labels.en?.value || labels.ja?.value || entity.title;
      const originalTitle = labels.ja?.value || labels.en?.value || title;
      const description = descriptions["zh-tw"]?.value || descriptions.zh?.value || descriptions.en?.value || "";
      const yearText = entity.claims?.P580?.[0]?.mainsnak?.datavalue?.value?.time || "";
      const year = Number((yearText.match(/\+(\d{4})/) || [])[1]) || "";
      const isAnime = /動畫|anime|television|season/i.test(description);
      return {
        id: Number(malId),
        title,
        originalTitle,
        description,
        year,
        episodes: "",
        source: "Wikidata",
        score: (isAnime ? 0.85 : 0.45) + (year && Math.abs(year - adapter.getPageYear()) <= 1 ? 0.1 : 0),
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
      ...(item.aliases || []),
    ]).filter(Boolean);
  }

  async function searchJikanCandidates(query) {
    const url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&type=tv&limit=8`;
    const data = await fetchJson(url);
    return (data?.data || []).map(item => ({
      id: item.mal_id,
      title: item.title_english || item.title || "",
      originalTitle: item.title || "",
      description: item.title_japanese || "",
      year: item.year || "",
      episodes: item.episodes || "",
      source: "MAL",
      score: scoreMalCandidate(item, query),
    }));
  }

  async function getJikanAnime(id) {
    const data = await fetchJson(`https://api.jikan.moe/v4/anime/${encodeURIComponent(id)}`);
    return data?.data || null;
  }

  async function searchWebMalCandidates(query) {
    const ids = [];
    const searches = [`${query} MyAnimeList`, `${query} MAL 作品編號`, `${query} site:myanimelist.net/anime`, `${query} MAL anime`];
    for (const text of searches) {
      const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(text)}`;
      const html = await requestText(url, "text/html,*/*").catch(() => "");
      const decodedHtml = html.replace(/&amp;/g, "&");
      const samples = [
        decodedHtml,
        ...Array.from(decodedHtml.matchAll(/[?&]uddg=([^&"'<>]+)/ig), match => decodePercent(match[1])),
      ];
      const re = /myanimelist\.net\/anime\/(\d+)\/([^"'&<\s]+)/ig;
      for (const sample of samples) {
        let match;
        while ((match = re.exec(sample))) {
          const id = Number(match[1]);
          if (id && !ids.includes(id)) ids.push(id);
        }
      }
      if (ids.length >= 5) break;
    }

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
        score: scoreMalCandidate(item, query) + 0.15,
      }];
    });
  }

  async function findMalCandidates() {
    const baseQueries = getSearchQueries();
    if (!baseQueries.length) return [];
    const hintResults = await Promise.allSettled(baseQueries.slice(0, 3).map(getWikidataTitleHints));
    const queries = [...baseQueries, ...hintResults.flatMap(result => result.status === "fulfilled" ? result.value : [])]
      .map(q => q.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((q, idx, arr) => arr.indexOf(q) === idx)
      .slice(0, 6);

    const jobs = queries.flatMap(query => [
      searchWikidataCandidates(query),
      searchJikanCandidates(query),
    ]);
    jobs.push(searchWebMalCandidates(baseQueries[0]));
    const settled = await Promise.allSettled(jobs);
    return uniqueCandidates(settled.flatMap(result => result.status === "fulfilled" ? result.value : []));
  }

  function saveMalChoice(candidate) {
    const cache = storeGet(MAL_CACHE_KEY, localReadJson("anime1MalCache", {}));
    const sharedKey = getSharedTitleKey();
    const value = Object.assign(compactCandidate(candidate), {
      time: Date.now(),
      selected: true,
      siteTitle: adapter.getTitle(),
      siteTitleKey: normalizeTitle(adapter.getTitle()),
      seriesKey: getSeriesKey(),
      sharedKey,
    });
    cache[getSeriesKey()] = value;
    if (sharedKey) cache[sharedKey] = value;
    storeSet(MAL_CACHE_KEY, cache);
  }

  function extractMalId(value) {
    const text = String(value || "").trim();
    const urlId = (text.match(/myanimelist\.net\/anime\/(\d+)/i) || [])[1];
    const plain = (text.match(/\d+/) || [])[0];
    const id = Number(urlId || plain);
    return Number.isInteger(id) && id > 0 ? id : 0;
  }

  async function saveManualMalId(value) {
    const id = extractMalId(value);
    if (!id) {
      alert("MAL ID 格式不正確，請輸入純數字或 MAL 網址。");
      return 0;
    }

    let candidate = {
      id,
      title: `MAL ${id}`,
      originalTitle: "",
      description: "",
      year: "",
      episodes: "",
      source: "手動輸入",
      score: 1,
    };

    try {
      const item = await getJikanAnime(id);
      if (item) {
        candidate = {
          id: item.mal_id || id,
          title: item.title_english || item.title || `MAL ${id}`,
          originalTitle: item.title || "",
          description: item.title_japanese || "",
          year: item.year || "",
          episodes: item.episodes || "",
          source: "手動輸入/Jikan",
          score: 1,
        };
      }
    } catch (_) {}

    saveMalChoice(candidate);
    notify(`已手動套用 MAL ID: ${id}`);
    return id;
  }

  async function promptManualMalId(prefix = "") {
    const current = getMalCacheEntry(storeGet(MAL_CACHE_KEY, localReadJson("anime1MalCache", {})))?.id || "";
    const picked = prompt(
      `${prefix}${prefix ? "\n\n" : ""}請輸入「${adapter.getTitle()}」的 MAL ID。\n` +
      "可輸入純數字，或貼上 MyAnimeList 動畫頁網址。",
      current ? String(current) : ""
    );
    if (picked == null) return 0;
    return saveManualMalId(picked);
  }

  async function chooseMalCandidate(force = true, preparedCandidates = null) {
    if (malChoicePromise) return malChoicePromise;
    malChoicePromise = chooseMalCandidateInner(force, preparedCandidates)
      .finally(() => { malChoicePromise = null; });
    return malChoicePromise;
  }

  async function chooseMalCandidateInner(force = true, preparedCandidates = null) {
    const candidates = preparedCandidates || await findMalCandidates();
    if (!candidates.length) {
      if (force) return promptManualMalId(`找不到「${adapter.getTitle()}」可能的候選 MAL ID。`);
      else notify(`找不到「${adapter.getTitle()}」可能的 MAL ID。`, 4200);
      return 0;
    }

    const message = candidates.map((item, idx) =>
      `${idx + 1}. ${item.title}` +
      `${item.originalTitle && item.originalTitle !== item.title ? ` / ${item.originalTitle}` : ""}` +
      `${item.year ? ` (${item.year})` : ""}` +
      `${item.episodes ? `, ${item.episodes} 集` : ""}` +
      `\n   MAL ID: ${item.id}，來源: ${item.source}，分數: ${item.score.toFixed(2)}` +
      `${item.description ? `\n   ${item.description}` : ""}`
    ).join("\n\n");
    const current = getMalCacheEntry(storeGet(MAL_CACHE_KEY, localReadJson("anime1MalCache", {})))?.id;
    const picked = prompt(
      `${force ? "請選擇" : "無法完全確定"}「${adapter.getTitle()}」的 MAL ID。\n` +
      `${current ? `目前使用: ${current}\n` : ""}` +
      "輸入候選編號即可套用；也可以直接輸入 MAL ID 或 MAL 網址。\n取消則暫不使用。\n\n" + message,
      "1"
    );

    if (picked == null) {
      return 0;
    }

    const idx = Number(picked) - 1;
    if (!Number.isInteger(idx) || !candidates[idx]) {
      const directId = extractMalId(picked);
      if (directId) return saveManualMalId(picked);
      alert("候選編號或 MAL ID 不正確，未套用。");
      return 0;
    }

    saveMalChoice(candidates[idx]);
    notify(`已套用 MAL ID: ${candidates[idx].id}`);
    return candidates[idx].id;
  }

  async function resolveMalId() {
    if (malResolvePromise) return malResolvePromise;
    malResolvePromise = resolveMalIdInner()
      .finally(() => { malResolvePromise = null; });
    return malResolvePromise;
  }

  async function resolveMalIdInner() {
    const cache = storeGet(MAL_CACHE_KEY, localReadJson("anime1MalCache", {}));
    const cached = getMalCacheEntry(cache);
    if (cached?.id && Date.now() - cached.time < 180 * 24 * 60 * 60 * 1000) {
      if (!cache[getSeriesKey()] || (getSharedTitleKey() && !cache[getSharedTitleKey()])) saveMalChoice(cached);
      return cached.id;
    }

    notify("正在搜尋作品 ID...", 5000);
    const candidates = await findMalCandidates();
    const best = candidates[0];
    if (best && best.score >= 0.9) {
      saveMalChoice(best);
      return best.id;
    }
    return chooseMalCandidate(false, candidates);
  }

  async function loadAniSkipRanges(duration) {
    const malId = await resolveMalId();
    const episode = adapter.getEpisodeNumber();
    if (!malId || !episode || !duration || !Number.isFinite(duration)) return [];

    const cache = storeGet(SKIP_CACHE_KEY, {});
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
        source: "AniSkip",
      }))
      .filter(r => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start);

    cache[cacheKey] = { time: Date.now(), ranges };
    storeSet(SKIP_CACHE_KEY, cache);
    return ranges;
  }

  async function loadBahaSkipRanges() {
    if (adapter.id !== "gamer" || typeof adapter.getEpisodeId !== "function") return [];
    const sn = adapter.getEpisodeId();
    if (!sn) return [];

    const cache = storeGet(SKIP_CACHE_KEY, {});
    const cacheKey = `baha:${sn}`;
    if (cache[cacheKey] && Date.now() - cache[cacheKey].time < 7 * 24 * 60 * 60 * 1000) {
      return cache[cacheKey].ranges || [];
    }

    const endpoints = [
      "https://jacoblincool.github.io/baha-anime-skip/",
      "https://raw.githubusercontent.com/JacobLinCool/baha-anime-skip/data/",
      "https://jacoblin.cool/baha-anime-skip/",
    ];
    for (const endpoint of endpoints) {
      try {
        const data = await fetchJson(`${endpoint}${encodeURIComponent(sn)}.json`);
        const ranges = Object.entries(data || {}).map(([chapter, value]) => {
          const start = Number(value?.[0]);
          const length = Number(value?.[1]);
          const upper = chapter.toUpperCase();
          return {
            type: upper === "ED" ? "outro" : "intro",
            start,
            end: start + length,
            source: "Bahamut Anime Skip",
          };
        }).filter(r => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start);
        cache[cacheKey] = { time: Date.now(), ranges };
        storeSet(SKIP_CACHE_KEY, cache);
        return ranges;
      } catch (_) {}
    }
    cache[cacheKey] = { time: Date.now(), ranges: [] };
    storeSet(SKIP_CACHE_KEY, cache);
    return [];
  }

  async function loadSkipRanges(duration) {
    const bahaRanges = await loadBahaSkipRanges();
    if (bahaRanges.length) return bahaRanges;
    return loadAniSkipRanges(duration);
  }

  function normalizeUrl(href) {
    try { return new URL(href, location.href).href; } catch (_) { return ""; }
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

  function isVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function canAcceptAgePrompt(key) {
    const now = Date.now();
    if (ageAcceptState.key !== key) ageAcceptState = { key, count: 0, last: 0 };
    if (now - ageAcceptState.last < 1800 || ageAcceptState.count >= 2) return false;
    ageAcceptState.count += 1;
    ageAcceptState.last = now;
    return true;
  }

  function markAutoplayWanted() {
    if (config.autoplayAfterJump) sessionStorage.setItem(AUTOPLAY_FLAG, "1");
  }

  function notify(message, ms = 2400) {
    injectStyles();
    document.getElementById("anime-skip-toast")?.remove();
    const toast = document.createElement("div");
    toast.id = "anime-skip-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), ms);
  }

  function goToNext(nextUrl) {
    if (!nextUrl) {
      notify("找不到下一集");
      return;
    }
    markAutoplayWanted();
    location.assign(nextUrl);
  }

  async function waitForVideo(ms) {
    const current = adapter.findVideo();
    if (current) return current;
    return new Promise(resolve => {
      const ob = new MutationObserver(() => {
        const v = adapter.findVideo();
        if (v) {
          ob.disconnect();
          resolve(v);
        }
      });
      ob.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => {
        ob.disconnect();
        resolve(adapter.findVideo());
      }, ms);
    });
  }

  async function waitForEpisodeVideo(ms) {
    const current = adapter.findVideo();
    if (isEpisodeVideo(current)) return current;
    return new Promise(resolve => {
      let closed = false;
      const done = video => {
        if (closed) return;
        closed = true;
        ob.disconnect();
        clearInterval(timer);
        clearTimeout(timeout);
        resolve(video);
      };
      const check = () => {
        const video = adapter.findVideo();
        if (isEpisodeVideo(video)) done(video);
      };
      const ob = new MutationObserver(check);
      const timer = setInterval(check, 600);
      const timeout = setTimeout(() => done(isEpisodeVideo(adapter.findVideo()) ? adapter.findVideo() : null), ms);
      ob.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      check();
    });
  }

  function wireAgePrompt() {
    if (typeof adapter.acceptAgePrompt !== "function") return;
    let lastNotice = 0;
    const accept = () => {
      if (!adapter.acceptAgePrompt()) return;
      if (Date.now() - lastNotice > 5000) {
        lastNotice = Date.now();
        notify("已自動確認年齡提示", 1600);
      }
    };
    accept();
    new MutationObserver(accept).observe(document.documentElement, { childList: true, subtree: true });
  }

  function visiblePlayButtons() {
    return Array.from(document.querySelectorAll(".vjs-big-play-button, .vjs-play-control"))
      .filter(button => isVisible(button) && !button.classList.contains("vjs-hidden"));
  }

  function getVideoJsPlayer(video) {
    try {
      const host = video?.closest(".video-js, video-js");
      const id = host?.id || video?.id?.replace(/_html5_api$/, "");
      if (id && typeof window.videojs === "function") return window.videojs(id);
      return host?.player || video?.player || null;
    } catch (_) {
      return null;
    }
  }

  async function playVideo(video) {
    const player = getVideoJsPlayer(video);
    try {
      const result = player?.play ? player.play() : video?.play?.();
      if (result?.catch) await result.catch(() => {});
    } catch (_) {}
  }

  async function tryStartPlayback(video, ms) {
    const deadline = Date.now() + ms;
    let clickCount = 0;
    let lastClick = 0;
    let lastPlayCall = 0;
    while (Date.now() < deadline) {
      if (!video || !document.contains(video)) video = adapter.findVideo();
      if (!video) {
        await sleep(500);
        continue;
      }

      const now = Date.now();
      const sourceReady = !!(video.currentSrc || video.src || video.readyState > 0);
      const buttons = visiblePlayButtons();
      const bigButton = buttons.find(item => item.classList.contains("vjs-big-play-button"));
      const controlButton = sourceReady ? buttons.find(item => item.classList.contains("vjs-play-control")) : null;
      const button = bigButton || controlButton;
      if (button && clickCount < 2 && now - lastClick > 3200) {
        try {
          button.click();
          clickCount += 1;
          lastClick = now;
        } catch (_) {}
      }

      if (sourceReady && now - lastPlayCall > 1800) {
        lastPlayCall = now;
        await playVideo(video);
      }

      if (!video.paused) return true;
      await sleep(900);
    }
    return false;
  }

  async function tryAutoplayIfRequested() {
    if (sessionStorage.getItem(AUTOPLAY_FLAG) !== "1") return;
    sessionStorage.removeItem(AUTOPLAY_FLAG);
    if (!config.autoplayAfterJump) return;
    if (typeof adapter.acceptAgePrompt === "function") adapter.acceptAgePrompt();
    const video = adapter.waitForEpisodeReadyBeforeAutoplay
      ? await waitForEpisodeVideo(22000)
      : await waitForVideo(8000);
    if (!video) return;
    await tryStartPlayback(video, adapter.waitForEpisodeReadyBeforeAutoplay ? 9000 : 14000);
  }

  function toggleFullscreen() {
    const video = adapter.findVideo();
    const target = video ? (video.closest(".video-js") || video) : document.documentElement;
    if (!document.fullscreenElement) {
      (target.requestFullscreen || target.webkitRequestFullscreen || (() => {})).call(target);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
    }
  }

  function formatTime(sec) {
    const value = Math.max(0, Number(sec) || 0);
    const m = Math.floor(value / 60);
    const s = Math.floor(value % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function getAdjustedRange(range, video, type) {
    const adjust = loadAdjust();
    const duration = Number(video?.duration);
    const max = Number.isFinite(duration) && duration > 0 ? duration : range.end;
    const offset = type === "intro" ? adjust.introOffset : adjust.outroOffset;
    const start = Math.max(0, Math.min(max, range.start + offset));
    const end = Math.max(start, Math.min(max, range.end + offset));
    return { start, end };
  }

  function getSkipTarget(range, video, type) {
    return getAdjustedRange(range, video, type).end;
  }

  function seekPaddingSeconds(type) {
    const value = Number(adapter.seekPaddingSeconds);
    if (!Number.isFinite(value)) return 0;
    return type === "outro" ? Math.max(0, Math.min(value, 0.6)) : Math.max(0, Math.min(value, 0.4));
  }

  function clampSeekTarget(video, target) {
    const duration = Number(video?.duration);
    if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, target);
    return Math.max(0, Math.min(duration - 0.8, target));
  }

  function setVideoTime(video, target) {
    const player = getVideoJsPlayer(video);
    try {
      if (player?.currentTime) {
        player.currentTime(target);
        return true;
      }
    } catch (_) {}
    try {
      video.currentTime = target;
      return true;
    } catch (_) {
      return false;
    }
  }

  function watchSeekRecovery(video, target, wasPaused) {
    if (wasPaused) return;
    const startedAt = video.currentTime;
    setTimeout(async () => {
      if (!document.contains(video)) return;
      const duration = Number(video.duration);
      if (video.ended || (Number.isFinite(duration) && video.currentTime >= duration - 1)) return;
      const barelyMoved = !video.paused && Math.abs(video.currentTime - startedAt) < 0.08;
      const unhealthy = video.readyState < 2 || (video.paused && !video.ended) || barelyMoved;
      if (!unhealthy) return;
      setVideoTime(video, clampSeekTarget(video, target + 0.7));
      await sleep(160);
      await playVideo(video);
    }, 2400);
  }

  async function skipToTarget(video, range, type) {
    const target = clampSeekTarget(video, getSkipTarget(range, video, type) + seekPaddingSeconds(type));
    const wasPaused = video.paused;
    const player = getVideoJsPlayer(video);
    try { player?.pause?.(); } catch (_) {}
    if (adapter.pauseBeforeSeek) {
      try { video.pause(); } catch (_) {}
      await sleep(120);
    }
    if (!setVideoTime(video, target)) return;
    if (!wasPaused) {
      await sleep(adapter.resumeAfterSeekDelay || 240);
      await playVideo(video);
      watchSeekRecovery(video, target, wasPaused);
    }
  }

  function isEpisodeVideo(video) {
    if (!video) return false;
    const duration = Number(video.duration);
    if (!Number.isFinite(duration) || duration <= 0) return false;
    return duration >= adapter.minEpisodeDuration;
  }

  function injectStyles() {
    if (document.getElementById("anime-skip-style")) return;
    const style = document.createElement("style");
    style.id = "anime-skip-style";
    style.textContent = `
      #anime-skip-toast {
        position:fixed;left:50%;top:18px;z-index:2147483647;transform:translateX(-50%);
        max-width:calc(100vw - 28px);border-radius:8px;padding:10px 12px;
        background:rgba(25,25,25,.92);color:#fff;
        font:14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      .anime-skip-popup {
        position:absolute;right:18px;bottom:68px;z-index:2147483647;
        display:flex;align-items:center;gap:8px;border-radius:8px;padding:8px 10px;
        background:rgba(20,20,20,.72);color:#fff;
        font:13px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        box-shadow:0 4px 16px rgba(0,0,0,.25);white-space:nowrap;max-width:calc(100% - 36px);
        opacity:.94;contain:layout paint;
      }
      .anime-skip-popup.is-fixed {
        position:fixed;right:22px;bottom:78px;max-width:calc(100vw - 28px);
      }
      .anime-skip-popup button {
        padding:2px 8px;border-radius:5px;border:none;cursor:pointer;font:inherit;font-size:12px;
      }
      .anime-skip-popup .btn-skip { background:rgba(255,255,255,.18);color:#fff; }
      .anime-skip-popup .btn-dismiss { background:rgba(255,255,255,.15);color:#fff; }
      #anime-skip-settings-backdrop {
        position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;
        background:rgba(0,0,0,.54);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      }
      #anime-skip-settings {
        width:min(520px,calc(100vw - 28px));max-height:calc(100vh - 34px);border-radius:8px;
        background:#fff;color:#1f2937;box-shadow:0 18px 46px rgba(0,0,0,.34);overflow:auto;
      }
      #anime-skip-settings header,#anime-skip-settings footer {
        display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;background:#f6f7f9;
      }
      #anime-skip-settings form { display:grid;gap:12px;padding:16px; }
      #anime-skip-settings h3 { margin:6px 0 0;font-size:14px; }
      #anime-skip-settings label { display:grid;gap:6px;font-size:14px; }
      #anime-skip-settings .anime-skip-check { grid-template-columns:18px 1fr;align-items:center; }
      #anime-skip-settings input[type="text"],#anime-skip-settings input[type="number"] {
        min-height:36px;border:1px solid #cdd3dc;border-radius:6px;padding:6px 8px;font:inherit;
      }
      #anime-skip-settings button {
        min-height:34px;border:1px solid #cdd3dc;border-radius:6px;padding:6px 10px;
        background:#fff;color:#1f2937;cursor:pointer;font:inherit;
      }
      #anime-skip-settings button[data-primary] { border-color:#1677ff;background:#1677ff;color:#fff; }
    `;
    document.head.appendChild(style);
  }

  function getVideoOverlayHost(video) {
    const fullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    if (fullscreen && fullscreen !== video && fullscreen.contains(video)) return fullscreen;
    return video?.closest(".video-js, video-js, #video-container, .videoframe, .container-player, .player, .video") || document.body;
  }

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function useNativeOnlySkipNotice(video) {
    const full = fullscreenElement();
    return !!(adapter.nativeFullscreenSkipNotice && full && (full === video || full.contains(video)));
  }

  function mountSkipToast(popup, video) {
    if (adapter.keepSkipPopupOutOfPlayer) {
      popup.classList.add("is-fixed");
      document.body.appendChild(popup);
      return;
    }

    const host = getVideoOverlayHost(video);
    if (!host || host === document.body || host === document.documentElement || host === video) {
      popup.classList.add("is-fixed");
      document.body.appendChild(popup);
      return;
    }
    const position = getComputedStyle(host).position;
    if (position === "static") {
      popup.classList.add("is-fixed");
      document.body.appendChild(popup);
      return;
    }
    host.appendChild(popup);
  }

  function clearSkipCue(video) {
    const track = video?._animeSkipNoticeTrack;
    const cue = video?._animeSkipNoticeCue;
    if (!track || !cue) return;
    try { track.removeCue(cue); } catch (_) {}
    video._animeSkipNoticeCue = null;
    video._animeSkipNoticeText = "";
  }

  function updateSkipCue(video, message) {
    if (!video || !message) return;
    const Cue = window.VTTCue || window.TextTrackCue;
    if (typeof Cue !== "function" || typeof video.addTextTrack !== "function") return;
    let track = video._animeSkipNoticeTrack;
    if (!track) {
      try {
        track = video.addTextTrack("captions", "AniSkip", "zh-TW");
        track.mode = "showing";
        video._animeSkipNoticeTrack = track;
      } catch (_) {
        return;
      }
    }

    try { track.mode = "showing"; } catch (_) {}
    clearSkipCue(video);
    const start = Math.max(0, Number(video.currentTime) || 0);
    try {
      const cue = new Cue(start, start + 0.9, message);
      try {
        cue.snapToLines = false;
        cue.line = 82;
        cue.position = 50;
        cue.align = "center";
      } catch (_) {}
      track.addCue(cue);
      video._animeSkipNoticeCue = cue;
      video._animeSkipNoticeText = message;
    } catch (_) {}
  }

  function showSkipToast(video, range, label, type, onSkip) {
    injectStyles();
    document.querySelector(".anime-skip-popup")?.remove();

    const nativeOnly = useNativeOnlySkipNotice(video);
    let popup = null;
    let text = null;
    let skipBtn = null;
    let closeBtn = null;
    if (!nativeOnly) {
      popup = document.createElement("div");
      popup.className = "anime-skip-popup";
      text = document.createElement("span");
      skipBtn = document.createElement("button");
      closeBtn = document.createElement("button");
      skipBtn.className = "btn-skip";
      skipBtn.textContent = "立即跳過";
      closeBtn.className = "btn-dismiss";
      closeBtn.textContent = "本次不跳";
      popup.append(text, skipBtn, closeBtn);
      mountSkipToast(popup, video);
    }

    let closed = false;
    function cleanup() {
      closed = true;
      clearInterval(timer);
      if (popup) popup.remove();
      clearSkipCue(video);
    }
    async function doSkip() {
      if (closed) return;
      cleanup();
      await skipToTarget(video, range, type);
      if (onSkip) onSkip();
    }
    function update() {
      const adjusted = getAdjustedRange(range, video, type);
      const remain = Math.max(0, Math.ceil(adjusted.start - video.currentTime));
      const message = remain > 0 ? `${remain} 秒後跳過${label}` : `跳過${label}`;
      if (text) text.textContent = message;
      if (nativeOnly || useNativeOnlySkipNotice(video)) updateSkipCue(video, message);
      if (video.currentTime >= adjusted.start - 0.05) doSkip();
      if (video.currentTime >= adjusted.end) cleanup();
    }

    if (skipBtn) skipBtn.addEventListener("click", doSkip);
    if (closeBtn) closeBtn.addEventListener("click", cleanup);
    const timer = setInterval(update, 250);
    update();
  }

  function wireSkipIntroOutro(video) {
    if (!video || video.dataset.animeSkipAttached === "1") return;
    video.dataset.animeSkipAttached = "1";

    let ranges = null;
    let loading = null;
    const state = { introWarned: false, introSkipped: false, outroWarned: false, outroSkipped: false };

    function reset() {
      ranges = null;
      loading = null;
      state.introWarned = state.introSkipped = state.outroWarned = state.outroSkipped = false;
      document.querySelector(".anime-skip-popup")?.remove();
    }

    function ensureRanges() {
      if (ranges || loading || !isEpisodeVideo(video)) return;
      loading = loadSkipRanges(video.duration)
        .catch(() => [])
        .then(result => {
          ranges = result;
          loading = null;
          check();
        });
    }

    function handleRange(type, label) {
      const range = ranges?.find(r => r.type === type);
      if (!range) return;
      const warnedKey = type === "intro" ? "introWarned" : "outroWarned";
      const skippedKey = type === "intro" ? "introSkipped" : "outroSkipped";
      if (!config.skipEnabled || state[skippedKey]) return;

      const adjusted = getAdjustedRange(range, video, type);
      const t = video.currentTime;
      const inLeadWindow = t >= adjusted.start - SKIP_NOTICE_SECONDS && t < adjusted.end;

      if (inLeadWindow && !state[warnedKey]) {
        state[warnedKey] = true;
        showSkipToast(video, range, label, type, () => { state[skippedKey] = true; });
      }
    }

    function check() {
      if (video.paused) return;
      ensureRanges();
      if (ranges?.length) {
        handleRange("intro", "片頭");
        handleRange("outro", "片尾");
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

  function wireEndedJump(video) {
    if (!video || video.dataset.animeEndedAttached === "1") return;
    video.dataset.animeEndedAttached = "1";
    let timer = 0;
    function cancelTimer() {
      clearTimeout(timer);
      timer = 0;
    }
    function onEnded() {
      const nextUrl = adapter.getNextUrl();
      if (!config.jumpWhenEnded || !nextUrl || timer || !isEpisodeVideo(video)) return;
      timer = setTimeout(() => goToNext(nextUrl), 0);
    }
    video.addEventListener("ended", onEnded);
    video.addEventListener("play", cancelTimer);
    video.addEventListener("seeking", cancelTimer);
  }

  function wireVideos() {
    const attach = video => {
      wireSkipIntroOutro(video);
      wireEndedJump(video);
    };
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
    else el.value = String(value ?? "");
    Object.assign(el, opts);
    return el;
  }

  function heading(text) {
    const h = document.createElement("h3");
    h.textContent = text;
    return h;
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
    label.className = "anime-skip-check";
    const span = document.createElement("span");
    span.textContent = text;
    label.append(input, span);
    return label;
  }

  function openSettings() {
    injectStyles();
    document.getElementById("anime-skip-settings-backdrop")?.remove();

    const backdrop = document.createElement("div");
    backdrop.id = "anime-skip-settings-backdrop";
    const dialog = document.createElement("section");
    dialog.id = "anime-skip-settings";

    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = "AniSkip 設定";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "關閉";
    close.addEventListener("click", () => backdrop.remove());
    header.append(title, close);

    const adjust = loadAdjust();
    const iNext = mkInput("text", config.nextHotkey); hotkeyInput(iNext);
    const iFull = mkInput("text", config.fullscreenHotkey); hotkeyInput(iFull);
    const iSettings = mkInput("text", config.settingsHotkey); hotkeyInput(iSettings);
    const iSkipEnabled = mkInput("checkbox", config.skipEnabled);
    const iIntroOffset = mkInput("number", adjust.introOffset, { min: -120, max: 120, step: 0.5 });
    const iOutroOffset = mkInput("number", adjust.outroOffset, { min: -120, max: 120, step: 0.5 });
    const iAutoplay = mkInput("checkbox", config.autoplayAfterJump);
    const iJumpEnded = mkInput("checkbox", config.jumpWhenEnded);

    const form = document.createElement("form");
    form.append(
      heading("快捷鍵"),
      field("下一集", iNext),
      field("全螢幕", iFull),
      field("開啟設定", iSettings),
      heading("AniSkip"),
      check("啟用自動跳過片頭/片尾", iSkipEnabled),
      heading(`本作微調：${adapter.getTitle() || adapter.name}`),
      field("片頭整段偏移（正數延後，負數提前）", iIntroOffset),
      field("片尾整段偏移（正數延後，負數提前）", iOutroOffset),
      heading("下一集"),
      check("跳集後嘗試自動播放", iAutoplay),
      check("影片自然結束後自動下一集", iJumpEnded)
    );

    const footer = document.createElement("footer");
    const save = document.createElement("button");
    save.type = "submit";
    save.dataset.primary = "true";
    save.textContent = "儲存";
    footer.append(save);
    form.append(footer);

    form.addEventListener("submit", e => {
      e.preventDefault();
      config = {
        nextHotkey: normalizeHotkey(iNext.value) || defaults.nextHotkey,
        fullscreenHotkey: normalizeHotkey(iFull.value) || defaults.fullscreenHotkey,
        settingsHotkey: normalizeHotkey(iSettings.value) || defaults.settingsHotkey,
        skipEnabled: iSkipEnabled.checked,
        autoplayAfterJump: iAutoplay.checked,
        jumpWhenEnded: iJumpEnded.checked,
      };
      saveConfig(config);
      saveAdjust({
        introOffset: iIntroOffset.value,
        outroOffset: iOutroOffset.value,
      });
      backdrop.remove();
      notify("已儲存設定");
    });

    backdrop.addEventListener("click", e => { if (e.target === backdrop) backdrop.remove(); });
    dialog.append(header, form);
    backdrop.append(dialog);
    document.body.append(backdrop);
    iNext.focus();
  }

  function describeAniSkipRanges(ranges) {
    if (!ranges?.length) return ["AniSkip: 沒有資料"];
    const sources = Array.from(new Set(ranges.map(r => r.source).filter(Boolean)));
    const lines = [sources.length ? `跳過資料: ${sources.join(", ")}` : "AniSkip: 有資料"];
    const intro = ranges.find(r => r.type === "intro");
    const outro = ranges.find(r => r.type === "outro");
    if (intro) lines.push(`片頭: ${formatTime(intro.start)} -> ${formatTime(intro.end)}`);
    if (outro) lines.push(`片尾: ${formatTime(outro.start)} -> ${formatTime(outro.end)}`);
    return lines;
  }

  function describeAdjust(adjust) {
    const lines = [];
    if (adjust.introOffset) lines.push(`片頭整段偏移: ${adjust.introOffset} 秒`);
    if (adjust.outroOffset) lines.push(`片尾整段偏移: ${adjust.outroOffset} 秒`);
    return lines;
  }

  async function showCurrentStatus() {
    notify("正在查詢作品與 AniSkip...");
    const malId = await resolveMalId();
    const cache = storeGet(MAL_CACHE_KEY, localReadJson("anime1MalCache", {}));
    const cached = getMalCacheEntry(cache);
    const video = adapter.findVideo();
    const duration = Number(video?.duration);
    const episode = adapter.getEpisodeNumber();
    const lines = [
      "當前作品",
      "",
      `站台: ${adapter.name}`,
      `標題: ${adapter.getTitle() || "無"}`,
      `集數: ${episode || "無法判斷"}`,
      `作品 key: ${getSeriesKey()}`,
      `MAL ID: ${malId || cached?.id || "尚未選擇/解析"}`,
      `MAL 標題: ${cached?.title || "無"}`,
      `來源: ${cached?.source || "無"}`,
    ];

    const adjustLines = describeAdjust(loadAdjust());
    if (adjustLines.length) lines.push("", ...adjustLines);
    lines.push("");

    if (!malId) {
      lines.push("AniSkip: 尚未取得 MAL ID");
    } else if (!episode) {
      lines.push("AniSkip: 無法判斷集數");
    } else if (!video) {
      lines.push("AniSkip: 找不到播放器");
    } else if (!isEpisodeVideo(video)) {
      lines.push(`AniSkip: 正片尚未載入或目前是廣告/提示片段（duration=${Number.isFinite(duration) ? duration.toFixed(1) : "未知"}）`);
    } else {
      try {
        lines.push(...describeAniSkipRanges(await loadSkipRanges(duration)));
      } catch (err) {
        lines.push(String(err?.message || "").includes("404") ? "AniSkip: 沒有資料" : `AniSkip: 查詢失敗 (${err.message || err})`);
      }
    }

    alert(lines.join("\n"));
  }

  function switchMalCandidate() {
    chooseMalCandidate(true).catch(err => alert(`取得候選失敗：${err.message || err}`));
  }

  function inputManualMalId() {
    promptManualMalId().catch(err => alert(`套用失敗：${err.message || err}`));
  }

  function wireHotkeys() {
    document.addEventListener("keydown", e => {
      if (isTypingTarget(document.activeElement)) return;
      const hk = eventToHotkey(e);
      const map = [
        [config.settingsHotkey, openSettings],
        [config.nextHotkey, () => goToNext(adapter.getNextUrl())],
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

  function registerMenus() {
    if (typeof GM_registerMenuCommand !== "function") return;
    GM_registerMenuCommand("AniSkip 設定", openSettings);
    GM_registerMenuCommand("顯示當前作品狀態", () => showCurrentStatus().catch(err => alert(`查詢失敗：${err.message || err}`)));
    GM_registerMenuCommand("選擇/切換作品 ID", switchMalCandidate);
    GM_registerMenuCommand("手動輸入作品 ID", inputManualMalId);
  }

  function getAdapter() {
    const host = location.hostname;
    if (host === "anime1.me") return createAnime1Adapter();
    if (host === "ani.gamer.com.tw") return createGamerAdapter();
    return null;
  }

  function createAnime1Adapter() {
    function apiData() {
      const raw = document.querySelector("video[data-apireq], .video-js[data-apireq]")?.dataset?.apireq;
      if (!raw) return {};
      try { return JSON.parse(decodePercent(raw)); } catch (_) { return {}; }
    }

    function headingText() {
      return document.querySelector("article h1")?.textContent ||
        document.querySelector("article h2")?.textContent ||
        document.querySelector("main article h1")?.textContent ||
        document.querySelector("main article h2")?.textContent ||
        document.title;
    }

    return {
      id: "anime1",
      name: "Anime1",
      minEpisodeDuration: 300,
      getTitle() {
        return cleanTitle(headingText());
      },
      getEpisodeNumber() {
        const rawApiEp = String(apiData().e || "");
        const apiEp = Number((rawApiEp.match(/\d+(?:\.\d+)?/) || [])[0]);
        if (Number.isFinite(apiEp) && apiEp > 0) return apiEp;
        return parseEpisodeNumber(headingText());
      },
      getSeriesKey() {
        const api = apiData();
        if (api.c) return `cat:${api.c}`;
        const category = document.querySelector("article a[href*='/category/'], a[href*='/category/']");
        if (category) {
          try {
            const u = new URL(category.getAttribute("href"), location.origin);
            return `category:${decodeURIComponent(u.pathname.replace(/^\/category\//, "").replace(/\/$/, ""))}`;
          } catch (_) {}
        }
        return `title:${normalizeTitle(this.getTitle())}`;
      },
      getPageYear() {
        const date = document.querySelector("article time, time")?.textContent || document.querySelector("article")?.textContent || "";
        const year = Number((date.match(/\b(20\d{2}|19\d{2})\b/) || [])[1]);
        return Number.isFinite(year) ? year : 0;
      },
      findVideo() {
        return document.querySelector("video");
      },
      getNextUrl() {
        const links = Array.from(document.querySelectorAll("a[href]"));
        const exact = links.find(a => a.textContent.trim() === "下一集");
        if (exact) return normalizeUrl(exact.getAttribute("href"));
        const loose = links.find(a => /下一集|next/i.test(a.textContent.trim()));
        return loose ? normalizeUrl(loose.getAttribute("href")) : "";
      },
    };
  }

  function createGamerAdapter() {
    function headingText() {
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content || "";
      return document.querySelector("h1")?.textContent?.trim() || ogTitle || document.title;
    }

    function titleText() {
      return cleanTitle(headingText());
    }

    function episodeIdFromUrl(url = location.href) {
      try { return new URL(url, location.origin).searchParams.get("sn") || ""; } catch (_) { return ""; }
    }

    function episodeItems() {
      const nodes = Array.from(document.querySelectorAll('.season a[href*="sn="], .season a[data-ani-video-sn], a[href*="animeVideo.php?sn="]'));
      const seen = new Set();
      return nodes.map((a, index) => {
        const href = normalizeUrl(a.getAttribute("href"));
        const sn = a.dataset?.aniVideoSn || episodeIdFromUrl(href);
        const text = (a.textContent || "").trim();
        const numericText = Number(text);
        const display = Number.isFinite(numericText) ? numericText : parseEpisodeNumber(text);
        return { index, href, sn, display };
      }).filter(item => {
        if (!item.href || !item.sn || !Number.isFinite(item.display) || seen.has(item.sn)) return false;
        seen.add(item.sn);
        return true;
      });
    }

    function isRegularEpisodeDisplay(display) {
      return Number.isInteger(display) && display > 0;
    }

    function relativeEpisodeFromList(items, currentSn, displayed) {
      const regularItems = items.filter(item => isRegularEpisodeDisplay(item.display));
      const currentRegularIndex = regularItems.findIndex(item => item.sn === currentSn);
      if (currentRegularIndex >= 0) return currentRegularIndex + 1;

      const currentItem = items.find(item => item.sn === currentSn);
      if (currentItem && !isRegularEpisodeDisplay(currentItem.display)) return 0;

      if (isRegularEpisodeDisplay(displayed) && regularItems.length) {
        const count = regularItems.filter(item => item.display <= displayed).length;
        if (count > 0) return count;
      }
      return 0;
    }

    function displayedEpisodeNumber() {
      return parseEpisodeNumber(headingText()) ||
        parseEpisodeNumber(document.querySelector('meta[property="og:title"]')?.content) ||
        parseEpisodeNumber(document.title);
    }

    return {
      id: "gamer",
      name: "巴哈姆特動畫瘋",
      minEpisodeDuration: 300,
      waitForEpisodeReadyBeforeAutoplay: true,
      keepSkipPopupOutOfPlayer: true,
      nativeFullscreenSkipNotice: true,
      seekPaddingSeconds: 0.25,
      pauseBeforeSeek: true,
      resumeAfterSeekDelay: 320,
      getTitle() {
        return titleText();
      },
      getEpisodeNumber() {
        const displayed = displayedEpisodeNumber();
        const items = episodeItems();
        const currentSn = this.getEpisodeId();
        const relative = relativeEpisodeFromList(items, currentSn, displayed);
        if (relative) return relative;
        if (displayed > 40 && getSeasonNumber(this.getTitle()) > 1) return 0;
        return isRegularEpisodeDisplay(displayed) ? displayed : 0;
      },
      getEpisodeId() {
        return episodeIdFromUrl();
      },
      getSeriesKey() {
        return `title:${normalizeTitle(this.getTitle())}`;
      },
      getPageYear() {
        const text = document.body?.innerText || "";
        const year = Number((text.match(/年份[:：]\s*(20\d{2}|19\d{2})/) || [])[1]);
        return Number.isFinite(year) ? year : 0;
      },
      findVideo() {
        return document.querySelector("#ani_video_html5_api") || document.querySelector("video");
      },
      acceptAgePrompt() {
        const cover = document.querySelector(".video-cover-ncc");
        if (!isVisible(cover) || !/同意/.test(cover.textContent || "")) return false;
        const agree = cover.querySelector("#adult, .choose-btn-agree") ||
          Array.from(cover.querySelectorAll("button,a,[role='button'],input[type='button'],input[type='submit']"))
            .find(el => ((el.textContent || el.value || "").trim() === "同意"));
        if (!isVisible(agree)) return false;
        const key = `${location.pathname}${location.search}:${this.getEpisodeId() || ""}`;
        if (!canAcceptAgePrompt(key)) return false;
        cover.dataset.animeSkipAgeAccepted = "1";
        agree.click();
        return true;
      },
      getNextUrl() {
        const items = episodeItems();
        const currentSn = this.getEpisodeId();
        const idx = items.findIndex(item => item.sn === currentSn);
        if (idx >= 0) return items[idx + 1]?.href || "";
        const displayed = displayedEpisodeNumber();
        const next = items.find(item => item.display > displayed);
        return next?.href || "";
      },
    };
  }

  registerMenus();
  wireHotkeys();
  wireAgePrompt();
  wireVideos();
  tryAutoplayIfRequested();
})();
