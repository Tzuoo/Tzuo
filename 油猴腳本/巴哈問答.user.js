// ==UserScript==
// @name         巴哈問答
// @namespace    https://tzuoo.github.io/Tzuo/
// @version      1.7.14
// @updateURL    https://raw.githubusercontent.com/Tzuoo/Tzuo/main/%E6%B2%B9%E7%8C%B4%E8%85%B3%E6%9C%AC/%E5%B7%B4%E5%93%88%E5%95%8F%E7%AD%94.user.js
// @downloadURL  https://raw.githubusercontent.com/Tzuoo/Tzuo/main/%E6%B2%B9%E7%8C%B4%E8%85%B3%E6%9C%AC/%E5%B7%B4%E5%93%88%E5%95%8F%E7%AD%94.user.js
// @description  Bahamut Anime daily quiz helper.
// @author       tzuoo
// @match        https://ani.gamer.com.tw/*
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @connect      api.aniskip.com
// @connect      api.anime-skip.com
// @connect      api.jikan.moe
// @connect      graphql.anilist.co
// @connect      api.bgm.tv
// @connect      acgsecrets.hk
// @connect      www.wikidata.org
// @connect      duckduckgo.com
// @connect      html.duckduckgo.com
// @connect      jacoblincool.github.io
// @connect      jacoblin.cool
// @connect      raw.githubusercontent.com
// @connect      ani.gamer.com.tw
// @connect      api.gamer.com.tw
// @connect      home.gamer.com.tw
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @homepageURL  https://tzuoo.github.io/Tzuo/
// ==/UserScript==

// <bundled-anime-mal-core>
/* Shared MAL resolver for anime收藏.user.js and 巴哈問答.user.js */
(function (root) {
  "use strict";
  if (root.AnimeMalCore) return;

  const seasonMonths = ["01", "04", "07", "10"];
  const directBridgeThreshold = 0.82;
  const bridgeCache = new Map();
  const normalize = value => String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/第\s*([一二三四五六七八九十\d]+)\s*(?:季|期)/g, (_, n) => `season${({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 })[n] || n}`)
    .replace(/[\s\p{P}\p{S}]/gu, "");
  const seasonNumber = value => {
    const text = String(value || "").normalize("NFKC");
    const zh = text.match(/第\s*([一二三四五六七八九十\d]+)\s*(?:季|期)/);
    const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    if (zh) return Number(zh[1]) || map[zh[1]] || 0;
    const en = text.match(/(?:season|part|cour|s)\s*(\d+)/i) || text.match(/(\d+)(?:st|nd|rd|th)\s*season/i);
    if (en) return Number(en[1]) || 0;
    const roman = text.match(/(?:^|[^A-Za-z])(II|III|IV|V|VI)(?:\s*)$/i);
    return ({ II: 2, III: 3, IV: 4, V: 5, VI: 6 })[roman?.[1]?.toUpperCase()] || 0;
  };
  const similarity = (a, b) => {
    const x = normalize(a), y = normalize(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (x.includes(y) || y.includes(x)) return Math.min(x.length, y.length) / Math.max(x.length, y.length) + 0.12;
    const grams = text => Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2));
    const gx = grams(x), gy = grams(y);
    if (!gx.length || !gy.length) return 0;
    const bag = new Map();
    gx.forEach(g => bag.set(g, (bag.get(g) || 0) + 1));
    let hit = 0;
    gy.forEach(g => { const count = bag.get(g) || 0; if (count) { hit++; bag.set(g, count - 1); } });
    return (2 * hit) / (gx.length + gy.length);
  };
  const maxSimilarity = (left, right) => Math.max(0, ...left.flatMap(a => right.map(b => similarity(a, b))));
  const unique = values => [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))];
  const lookupAliases = aliases => {
    const priority = value => {
      let score = Math.min(String(value).length, 80) / 1000;
      if (/[A-Za-z]{3}/.test(value)) score += 4;
      if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(value)) score += 3;
      if (/\p{Script=Han}/u.test(value)) score += 2;
      if (/[A-Za-z]{3}/.test(value) && /\p{Script=Han}/u.test(value)) score -= 3;
      if (/(?:season|第\s*\d+\s*[季期]|\d+(?:st|nd|rd|th)\s*season)/i.test(value)) score += 0.2;
      return score;
    };
    return unique(aliases).sort((a, b) => priority(b) - priority(a)).slice(0, 6);
  };

  async function loadAcgBridges(year, requestText) {
    if (!year) return [];
    if (!bridgeCache.has(year)) bridgeCache.set(year, Promise.all(seasonMonths.map(async month => {
      try {
        const html = await requestText(`https://acgsecrets.hk/bangumi/${year}${month}/`, "text/html,*/*");
        const groups = [];
        for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
          try {
            const data = JSON.parse(match[1]);
            for (const item of data.itemListElement || []) {
              if (item?.name) groups.push({
                aliases: unique([item.name, ...(Array.isArray(item.alternateName) ? item.alternateName : [])]),
                url: String(item.url || ""),
              });
            }
          } catch (_) {}
        }
        return groups;
      } catch (_) { return []; }
    })).then(parts => parts.flat()));
    return bridgeCache.get(year);
  }

  async function acgDirectCandidate(bridge, context, requestText) {
    if (!bridge?.url) return null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // Some ACG Secrets pages expose the URL inside JSON, where slashes are escaped.
        const html = String(await requestText(bridge.url, "text/html,*/*")).replace(/\\\//g, "/");
        const match = html.match(/https?:\/\/(?:www\.)?myanimelist\.net\/anime\/(\d+)/i);
        const id = Number(match?.[1]);
        if (!id) continue;
        const aliases = bridge.aliases || [];
        return {
          id,
          title: aliases.find(value => /[A-Za-z]{3}/.test(value)) || aliases[0] || "",
          originalTitle: aliases.find(value => /\p{Script=Hiragana}|\p{Script=Katakana}/u.test(value)) || aliases[0] || "",
          year: context.year || new Date().getFullYear(),
          episodes: "",
          source: "ACG Secrets → MAL",
          score: 1.5,
        };
      } catch (_) {
        // Retry once: a temporary ACG response must not downgrade an exact match.
      }
    }
    return null;
  }

  async function aniListCandidates(aliases, context, postJson) {
    const wantedSeason = Number(context.season) || seasonNumber(context.title);
    const gql = `query($search:String){Page(page:1,perPage:8){media(type:ANIME,search:$search,format_in:[TV,TV_SHORT,ONA]){idMal seasonYear episodes format title{romaji english native}synonyms}}}`;
    const results = await Promise.allSettled(lookupAliases(aliases).map(alias =>
      postJson("https://graphql.anilist.co", { query: gql, variables: { search: alias } })
    ));
    return results.flatMap(result => result.status === "fulfilled" ? (result.value?.data?.Page?.media || []) : [])
      .filter(item => item.idMal)
      .map(item => {
        const titles = unique([item.title?.romaji, item.title?.english, item.title?.native, ...(item.synonyms || [])]);
        const candidateSeason = Math.max(0, ...titles.map(seasonNumber));
        let score = maxSimilarity(aliases, titles);
        if (context.year && item.seasonYear) score += Math.abs(Number(item.seasonYear) - Number(context.year)) <= 1 ? 0.18 : -0.35;
        if (wantedSeason) score += candidateSeason === wantedSeason ? 0.3 : -0.55;
        if (context.episode && item.episodes && Number(item.episodes) >= Number(context.episode)) score += 0.04;
        return { id: Number(item.idMal), title: item.title?.english || item.title?.romaji || "", originalTitle: item.title?.native || item.title?.romaji || "", year: item.seasonYear || "", episodes: item.episodes || "", source: "ACG Secrets → AniList", score, candidateSeason };
      })
      .filter(item => !wantedSeason || item.candidateSeason === wantedSeason ||
        (!item.candidateSeason && (!context.year || !item.year || Math.abs(Number(item.year) - Number(context.year)) <= 1)))
      .map(({ candidateSeason: _, ...item }) => item);
  }

  async function jikanCandidates(aliases, context, requestText) {
    const wantedSeason = Number(context.season) || seasonNumber(context.title);
    const results = await Promise.allSettled(lookupAliases(aliases).map(async alias => {
      const text = await requestText(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(alias)}&type=tv&limit=8`, "application/json,text/plain,*/*");
      return JSON.parse(text)?.data || [];
    }));
    return results.flatMap(result => result.status === "fulfilled" ? result.value : []).map(item => {
      const titles = unique([item.title, item.title_english, item.title_japanese, ...(item.title_synonyms || []), ...((item.titles || []).map(title => title.title))]);
      const candidateSeason = Math.max(0, ...titles.map(seasonNumber));
      let score = maxSimilarity(aliases, titles);
      if (context.year && item.year) score += Math.abs(Number(item.year) - Number(context.year)) <= 1 ? 0.18 : -0.35;
      if (wantedSeason) score += candidateSeason === wantedSeason ? 0.3 : -0.55;
      return { id: Number(item.mal_id), title: item.title_english || item.title || "", originalTitle: item.title_japanese || item.title || "", year: item.year || "", episodes: item.episodes || "", source: "ACG Secrets → Jikan", score, candidateSeason };
    })
      .filter(item => item.id && (!wantedSeason || item.candidateSeason === wantedSeason ||
        (!item.candidateSeason && (!context.year || !item.year || Math.abs(Number(item.year) - Number(context.year)) <= 1))))
      .map(({ candidateSeason: _, ...item }) => item);
  }

  async function findCandidates(context, io) {
    const wantedSeason = Number(context.season) || seasonNumber(context.title);
    const stem = String(context.title || "")
      .replace(/第\s*[一二三四五六七八九十\d]+\s*(?:季|期)/g, "")
      .replace(/(?:season|part|cour|s)\s*\d+/ig, "")
      .replace(/\s+\d+\s*$/, "")
      .trim();
    const base = unique([
      context.title,
      ...(context.aliases || []),
      wantedSeason && stem ? `${stem} Season ${wantedSeason}` : "",
      wantedSeason && stem ? `${stem} 第${wantedSeason}季` : "",
    ]);
    const bridges = await loadAcgBridges(Number(context.year) || new Date().getFullYear(), io.requestText);
    let aliases = base;
    let bridgeScore = 0;
    let bridge = null;
    for (const group of bridges) {
      const score = maxSimilarity(base, group.aliases);
      if (score > bridgeScore) { bridgeScore = score; aliases = unique([...base, ...group.aliases]); bridge = group; }
    }
    const bridgeSeason = Math.max(0, ...((bridge?.aliases || []).map(seasonNumber)));
    if (wantedSeason > 1 && bridgeSeason !== wantedSeason) {
      bridgeScore = 0;
      bridge = null;
      aliases = base;
    }
    // ACG Secrets spans a whole year. A loose partial-title match can point at
    // a different series or sequel and then return a confidently wrong MAL ID.
    if (bridgeScore < directBridgeThreshold) aliases = base;

    if (bridgeScore >= directBridgeThreshold) {
      const direct = await acgDirectCandidate(bridge, context, io.requestText);
      if (direct) return { candidates: [direct], aliases, bridgeMatched: true };
    }

    let candidates = await aniListCandidates(aliases, context, io.postJson);
    if (!candidates.length || Math.max(...candidates.map(item => item.score), 0) < 0.9) {
      candidates.push(...await jikanCandidates(aliases, context, io.requestText));
    }
    const byId = new Map();
    for (const item of candidates.sort((a, b) => b.score - a.score)) if (!byId.has(item.id)) byId.set(item.id, item);
    candidates = [...byId.values()].slice(0, 8);
    return { candidates, aliases, bridgeMatched: bridgeScore >= directBridgeThreshold };
  }

  root.AnimeMalCore = Object.freeze({
    version: "1.2.2",
    findCandidates,
    normalize,
    similarity,
    seasonNumber,
  });
})(globalThis);
// </bundled-anime-mal-core>

(function () {
  "use strict";

  const SCRIPT_PREFIX = "animeAniSkip";
  const CONFIG_KEY = `${SCRIPT_PREFIX}.config`;
  // v2 intentionally ignores older fuzzy title matches that may contain a
  // confidently cached MAL ID for another title or sequel.
  const MAL_CACHE_KEY = `${SCRIPT_PREFIX}.malCache.v5`;
  const SKIP_CACHE_KEY = `${SCRIPT_PREFIX}.skipCache`;
  const ADJUST_KEY = `${SCRIPT_PREFIX}.adjust`;
  const VIEW_MODE_FLAG = `${SCRIPT_PREFIX}.viewMode`;
  const QUIZ_RECORD_KEY = `${SCRIPT_PREFIX}.gamerQuizRecord`;
  const SKIP_NOTICE_SECONDS = 5;
  const SKIP_CACHE_LIMIT = 500;
  const POSITIVE_CACHE_MS = 24 * 60 * 60 * 1000;
  const NEGATIVE_CACHE_MS = 60 * 60 * 1000;

  const defaults = {
    nextHotkey: "v",
    statusHotkey: "n",
    settingsHotkey: "ctrl+shift+n",
    skipEnabled: true,
    animeSkipClientId: "",
    jumpWhenEnded: false,
    autoAnswerGamerQuiz: true,
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
    if (saved.statusHotkey === undefined && normalizeHotkey(saved.nextHotkey) === "n") {
      merged.nextHotkey = defaults.nextHotkey;
    }
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
  let gamerQuizPromise = null;
  let gamerQuizWarned = false;

  function getSeriesKey() {
    const siteKey = adapter.getSeriesKey() || normalizeTitle(adapter.getTitle()) || location.pathname;
    const season = getActiveSeasonNumber();
    return `${adapter.id}:${siteKey}${season ? `:season:${season}` : ""}`;
  }

  function getSharedTitleKey() {
    const title = normalizeTitle(adapter.getTitle());
    const season = getActiveSeasonNumber();
    return title ? `shared:title:${title}${season ? `:season:${season}` : ""}` : "";
  }

  function getMalCacheEntry(cache) {
    const seriesEntry = cache[getSeriesKey()];
    if (isMalCacheEntryCompatible(seriesEntry)) return seriesEntry;
    const sharedKey = getSharedTitleKey();
    if (sharedKey && isMalCacheEntryCompatible(cache[sharedKey])) return cache[sharedKey];

    // Never use a partial-title fallback here. Similar titles and sequels often
    // share long substrings but use entirely different MAL IDs.
    return null;
  }

  function isMalCacheEntryCompatible(entry) {
    if (!entry?.id) return false;
    const currentTitleKey = normalizeTitle(adapter.getTitle());
    const currentSeason = getActiveSeasonNumber();
    const currentYear = Number(adapter.getPageYear()) || 0;
    if (!entry.resolvedTitleKey || entry.resolvedTitleKey !== currentTitleKey) return false;
    if (currentSeason && Number(entry.resolvedSeason) !== currentSeason) return false;
    if (currentYear && Number(entry.resolvedYear) !== currentYear) return false;
    return true;
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

  function readSkipCache(cache, key) {
    const entry = cache[key];
    if (!entry) return null;
    const ttl = entry.ranges?.length ? POSITIVE_CACHE_MS : NEGATIVE_CACHE_MS;
    return Date.now() - Number(entry.time || 0) < ttl ? entry.ranges || [] : null;
  }

  function writeSkipCache(cache, key, ranges) {
    cache[key] = { time: Date.now(), ranges };
    const entries = Object.entries(cache);
    if (entries.length > SKIP_CACHE_LIMIT) {
      entries.sort((a, b) => Number(b[1]?.time || 0) - Number(a[1]?.time || 0));
      Object.keys(cache).forEach(cacheKey => delete cache[cacheKey]);
      entries.slice(0, SKIP_CACHE_LIMIT).forEach(([cacheKey, entry]) => { cache[cacheKey] = entry; });
    }
    storeSet(SKIP_CACHE_KEY, cache);
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

  function postAnimeSkip(query, variables) {
    const clientId = String(config.animeSkipClientId || "").trim();
    if (!clientId) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({ method: "POST", url: "https://api.anime-skip.com/graphql", timeout: 15000,
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-Client-ID": clientId },
        data: JSON.stringify({ query, variables }),
        onload: res => { try { if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`); const body = JSON.parse(res.responseText || "{}"); if (body.errors?.length) throw new Error(body.errors[0].message); resolve(body.data); } catch (error) { reject(error); } },
        onerror: reject, ontimeout: () => reject(new Error("Anime Skip timeout")),
      });
    });
  }

  function postJson(url, payload) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(payload);
      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method: "POST",
          url,
          data: body,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 15000,
          onload: response => {
            if (response.status < 200 || response.status >= 300) {
              reject(new Error(`HTTP ${response.status}`));
              return;
            }
            try {
              resolve(JSON.parse(response.responseText || "{}"));
            } catch (error) {
              reject(error);
            }
          },
          onerror: reject,
          ontimeout: () => reject(new Error("HTTP timeout")),
        });
        return;
      }
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
        credentials: "omit",
      })
        .then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then(resolve, reject);
    });
  }

  function gmRequestJson(method, url, data = null) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method,
          url,
          data,
          headers: data ? { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" } : undefined,
          responseType: "json",
          timeout: 15000,
          onload: res => {
            if (res.status < 200 || res.status >= 300) {
              reject(new Error(`HTTP ${res.status}`));
              return;
            }
            try {
              resolve(res.response ?? JSON.parse(res.responseText || "{}"));
            } catch (err) {
              reject(err);
            }
          },
          onerror: () => reject(new Error("網路連線失敗")),
          ontimeout: () => reject(new Error("網路連線逾時")),
        });
        return;
      }
      fetch(url, {
        method,
        credentials: "include",
        headers: data ? { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" } : undefined,
        body: data,
      }).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      }).then(resolve, reject);
    });
  }

  function taipeiDateKey() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const value = type => parts.find(part => part.type === type)?.value || "";
    return `${value("year")}-${value("month")}-${value("day")}`;
  }

  function quizErrorMessage(value) {
    return String(value?.msg || value?.message || value?.error || "");
  }

  function isQuizAlreadyAnswered(value) {
    return /已經答過|一天僅限一次|already answered/i.test(quizErrorMessage(value));
  }

  async function getGamerQuiz() {
    const result = await gmRequestJson("GET", "https://ani.gamer.com.tw/ajax/animeGetQuestion.php");
    if (result?.error !== undefined) throw result;
    if (!result?.token || !result?.question) throw new Error("無法取得動畫瘋每日題目");
    return result;
  }

  function getGamerQuizOptions(quiz) {
    const direct = [1, 2, 3, 4].map(index =>
      quiz?.[`a${index}`] ?? quiz?.[`ans${index}`] ?? quiz?.[`answer${index}`] ?? ""
    );
    if (direct.some(Boolean)) return direct.map(value => String(value || "").trim());
    const list = Array.isArray(quiz?.options) ? quiz.options : [];
    return [0, 1, 2, 3].map(index => {
      const item = list[index];
      return String(item?.text ?? item?.label ?? item ?? "").trim();
    });
  }

  function getGamerQuizAnswerText(quiz, answer) {
    return getGamerQuizOptions(quiz)[Number(answer) - 1] || "";
  }

  async function submitGamerQuiz(quiz, answer) {
    const params = new URLSearchParams({
      ans: String(answer),
      token: String(quiz.token),
      t: String(Date.now()),
    });
    const result = await gmRequestJson(
      "POST",
      "https://ani.gamer.com.tw/ajax/animeAnsQuestion.php",
      params.toString()
    );
    if (result?.error !== undefined && !isQuizAlreadyAnswered(result)) throw result;
    return result;
  }

  function parseQuizAnswer(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    const text = doc.querySelector("#article_content, #home_content, .MSG-list8C")?.textContent || "";
    const matched = text.match(/[aAＡ]\s*[\.:：、]?\s*([1-4１-４])/);
    if (!matched) return 0;
    const normalized = matched[1].replace(/[１-４]/g, ch => String("１２３４".indexOf(ch) + 1));
    return Number(normalized) || 0;
  }

  async function answerFromBlackxblue() {
    const listResult = await gmRequestJson(
      "GET",
      "https://api.gamer.com.tw/home/v2/creation_list.php?owner=blackXblue"
    );
    const today = taipeiDateKey().slice(5).replace("-", "/");
    const creation = (listResult?.data?.list || []).find(item => {
      const match = String(item?.title || "").match(/(\d{1,2})[/-](\d{1,2})/);
      return match && `${match[1].padStart(2, "0")}/${match[2].padStart(2, "0")}` === today;
    });
    if (!creation?.csn) throw new Error("今日解答貼文尚未發布");
    const html = await requestText(
      `https://home.gamer.com.tw/artwork.php?sn=${encodeURIComponent(creation.csn)}`,
      "text/html,*/*"
    );
    const answer = parseQuizAnswer(html);
    if (!answer) throw new Error("今日解答貼文內找不到答案");
    return answer;
  }

  async function answerFromQuizCollection(question) {
    const params = new URLSearchParams({ question: String(question), type: "quiz" });
    const result = await gmRequestJson(
      "GET",
      `https://script.google.com/macros/s/AKfycbxYKwsjq6jB2Oo0xwz4bmkd3-5hdguopA6VJ5KD/exec?${params}`
    );
    const answer = Number(result?.data?.answer);
    if (!result?.success || answer < 1 || answer > 4) throw new Error("題庫查不到答案");
    return answer;
  }

  async function ensureGamerQuizAnswered({ quiet = false } = {}) {
    if (adapter.id !== "gamer" || !config.autoAnswerGamerQuiz) return true;
    const record = storeGet(QUIZ_RECORD_KEY, {});
    const today = taipeiDateKey();
    if (record.date === today && record.done) return true;
    if (gamerQuizPromise) return gamerQuizPromise;

    gamerQuizPromise = (async () => {
      let quiz;
      try {
        quiz = await getGamerQuiz();
      } catch (err) {
        if (isQuizAlreadyAnswered(err)) {
          storeSet(QUIZ_RECORD_KEY, { date: today, done: true, status: "already-answered" });
          return true;
        }
        storeSet(QUIZ_RECORD_KEY, {
          date: today,
          done: false,
          status: "error",
          error: quizErrorMessage(err) || String(err),
        });
        if (!quiet) notify(`每日問答檢查失敗：${quizErrorMessage(err) || err}`, 5000);
        return false;
      }

      let answer = 0;
      try {
        answer = await answerFromBlackxblue();
      } catch (_) {
        try { answer = await answerFromQuizCollection(quiz.question); } catch (_) {}
      }
      if (!answer) {
        storeSet(QUIZ_RECORD_KEY, {
          date: today,
          done: false,
          status: "waiting",
          question: quiz.question,
          options: getGamerQuizOptions(quiz),
        });
        if (!quiet && !gamerQuizWarned) {
          gamerQuizWarned = true;
          alert(`動畫瘋今日題目尚未找到可靠答案，已暫停自動跳集，避免錯過作答。\n\n${quiz.question}`);
        }
        return false;
      }

      try {
        const result = await submitGamerQuiz(quiz, answer);
        const options = getGamerQuizOptions(quiz);
        storeSet(QUIZ_RECORD_KEY, {
          date: today,
          done: true,
          status: "auto-answered",
          answer,
          answerText: getGamerQuizAnswerText(quiz, answer),
          options,
          gift: result?.gift || "",
          question: quiz.question,
        });
        const answerText = getGamerQuizAnswerText(quiz, answer);
        if (!quiet) notify(
          `動畫瘋每日問答已自動作答（第 ${answer} 項${answerText ? `：${answerText}` : ""}）：${result?.gift || "完成"}`,
          7000
        );
        return true;
      } catch (err) {
        storeSet(QUIZ_RECORD_KEY, {
          date: today,
          done: false,
          status: "error",
          answer,
          answerText: getGamerQuizAnswerText(quiz, answer),
          options: getGamerQuizOptions(quiz),
          question: quiz.question,
          error: quizErrorMessage(err) || String(err),
        });
        if (!quiet) notify(`每日問答提交失敗：${quizErrorMessage(err) || err}`, 5000);
        return false;
      }
    })().finally(() => { gamerQuizPromise = null; });
    return gamerQuizPromise;
  }

  async function getGamerQuizStatus({ refresh = false } = {}) {
    const today = taipeiDateKey();
    let record = storeGet(QUIZ_RECORD_KEY, {});
    if (record.date !== today) record = {};
    if (record.done || (!refresh && record.status)) return record;

    try {
      const quiz = await getGamerQuiz();
      const pending = {
        date: today,
        done: false,
        status: "pending",
        question: quiz.question,
        options: getGamerQuizOptions(quiz),
      };
      storeSet(QUIZ_RECORD_KEY, pending);
      return pending;
    } catch (err) {
      if (isQuizAlreadyAnswered(err)) {
        const done = { date: today, done: true, status: "already-answered" };
        storeSet(QUIZ_RECORD_KEY, done);
        return done;
      }
      return {
        date: today,
        done: false,
        status: "error",
        error: quizErrorMessage(err) || String(err),
      };
    }
  }

  function describeGamerQuizStatus(record) {
    const lines = ["動畫瘋每日問答", ""];
    if (record?.done) {
      lines.push(record.status === "auto-answered" ? "狀態：✅ 今日已自動作答" : "狀態：✅ 今日已完成");
      if (record.answer) {
        lines.push(`正確答案：第 ${record.answer} 項${record.answerText ? `－${record.answerText}` : ""}`);
      }
      if (record.gift) lines.push(`獎勵：${record.gift}`);
      if (record.question) lines.push(`題目：${record.question}`);
      if (record.options?.some(Boolean)) {
        lines.push("選項：", ...record.options.map((option, index) => `${index + 1}. ${option}`));
      }
      return lines;
    }
    if (record?.status === "waiting") {
      lines.push("狀態：⏳ 尚未找到可靠答案（自動跳集已暫停）");
    } else if (record?.status === "pending") {
      lines.push("狀態：⏳ 今日尚未作答");
    } else {
      lines.push("狀態：❌ 無法確認或提交失敗");
    }
    if (record?.question) lines.push(`題目：${record.question}`);
    if (record?.options?.some(Boolean)) {
      lines.push("選項：", ...record.options.map((option, index) => `${index + 1}. ${option}`));
    }
    if (record?.answer) {
      lines.push(`嘗試答案：第 ${record.answer} 項${record.answerText ? `－${record.answerText}` : ""}`);
    }
    if (record?.error) lines.push(`原因：${record.error}`);
    return lines;
  }

  async function showGamerQuizStatus() {
    notify("正在查詢動畫瘋每日問答...");
    const status = await getGamerQuizStatus({ refresh: true });
    alert(describeGamerQuizStatus(status).join("\n"));
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
    if (en) return Number(en[1]) || 0;
    const roman = source.normalize("NFKC").match(/(?:^|[^A-Za-z])(II|III|IV|V|VI)(?:\s*)$/i);
    return ({ II: 2, III: 3, IV: 4, V: 5, VI: 6 })[roman?.[1]?.toUpperCase()] || 0;
  }

  function getActiveSeasonNumber() {
    return Number(adapter.getSeasonNumber?.()) || getSeasonNumber(adapter.getTitle());
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

  function detectSeasonNumber(text) {
    const source = String(text || "").normalize("NFKC");
    const zhDigits = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 };
    const zh = source.match(/第\s*([一二三四五六七八九十\d]+)\s*(?:季|期)/);
    if (zh) return Number(zh[1]) || zhDigits[zh[1]] || 0;
    const en = source.match(/(?:season|part|cour|s)\s*(\d+)/i) || source.match(/(\d+)(?:st|nd|rd|th)\s*season/i);
    if (en) return Number(en[1]) || 0;
    const roman = source.match(/(?:^|[^A-Za-z])(II|III|IV|V|VI)(?:\s*)$/i);
    return ({ II: 2, III: 3, IV: 4, V: 5, VI: 6 })[roman?.[1]?.toUpperCase()] || 0;
  }

  function optimizedSearchQueries() {
    const raw = String(adapter.getTitle() || "").normalize("NFKC").replace(/\[[^\]]+\]/g, "").trim();
    const season = Number(adapter.getSeasonNumber?.()) || detectSeasonNumber(raw);
    const base = raw
      .replace(/第\s*[一二三四五六七八九十\d]+\s*(?:季|期)/g, "")
      .replace(/(?:season|part|cour|s)\s*\d+/ig, "")
      .replace(/\s+/g, " ")
      .trim();
    return [
      raw,
      base,
      season ? `${base} Season ${season}` : "",
      season ? `${base} 第${season}季` : "",
      raw.split(/[：:]/)[0].trim(),
    ].filter(Boolean).filter((q, i, all) => all.indexOf(q) === i);
  }

  function hasMatchingSeason(titles, wanted) {
    if (!wanted) return true;
    return titles.some(title => detectSeasonNumber(title) === wanted);
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

    const wantedSeason = Number(adapter.getSeasonNumber?.()) || detectSeasonNumber(adapter.getTitle());
    if (wantedSeason) {
      const haystack = titles.join(" ");
      const seasonMatch =
        new RegExp(`(?:season|s)\\s*${wantedSeason}\\b`, "i").test(haystack) ||
        new RegExp(`${wantedSeason}(?:st|nd|rd|th)\\s*season`, "i").test(haystack) ||
        new RegExp(`第\\s*${wantedSeason}\\s*(?:季|期)`).test(haystack);
      score += seasonMatch ? 0.45 : -0.8;
    }

    if (wantedSeason) score += hasMatchingSeason(titles, wantedSeason) ? 1.25 : 0.8;
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

  async function searchBangumiTitleHints(query) {
    const data = await postJson("https://api.bgm.tv/v0/search/subjects", { keyword: query, filter: { type: [2] }, limit: 8 });
    const pageYear = Number(adapter.getPageYear()) || 0;
    return (data?.data || [])
      .filter(item => { const year = Number(String(item.date || "").slice(0, 4)); return !pageYear || !year || Math.abs(year - pageYear) <= 1; })
      .flatMap(item => [item.name_cn, item.name])
      .filter(Boolean);
  }

  async function searchAniListCandidates(query) {
    const gql = `query($search:String){Page(page:1,perPage:8){media(type:ANIME,search:$search,format_in:[TV,TV_SHORT,ONA]){idMal seasonYear episodes format title{romaji english native}synonyms}}}`;
    const data = await postJson("https://graphql.anilist.co", { query: gql, variables: { search: query } });
    return (data?.data?.Page?.media || []).filter(item => item.idMal).map(item => {
      const shaped = { title: item.title?.romaji, title_english: item.title?.english, title_japanese: item.title?.native, title_synonyms: item.synonyms || [], year: item.seasonYear, episodes: item.episodes, type: item.format };
      return { id: item.idMal, title: item.title?.english || item.title?.romaji || "", originalTitle: item.title?.native || item.title?.romaji || "", description: "", year: item.seasonYear || "", episodes: item.episodes || "", source: "AniList/MAL ID", score: scoreMalCandidate(shaped, query) + 0.2 };
    });
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
    if (globalThis.AnimeMalCore?.findCandidates) {
      const shared = await globalThis.AnimeMalCore.findCandidates({
        title: adapter.getTitle(),
        year: Number(adapter.getPageYear()) || 0,
        season: getActiveSeasonNumber(),
        episode: Number(adapter.getEpisodeNumber()) || 0,
        aliases: optimizedSearchQueries(),
      }, { requestText, postJson }).catch(() => null);
      if (shared?.candidates?.length) return uniqueCandidates(shared.candidates);
    }

    const baseQueries = optimizedSearchQueries();
    if (!baseQueries.length) return [];

    const seedQueries = baseQueries.slice(0, 2);
    const hintResults = await Promise.allSettled(seedQueries.flatMap(query => [
      getWikidataTitleHints(query),
      searchBangumiTitleHints(query),
    ]));
    const queries = [...baseQueries, ...hintResults.flatMap(result => result.status === "fulfilled" ? result.value : [])]
      .map(q => String(q || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((q, idx, arr) => arr.indexOf(q) === idx)
      .slice(0, 5);

    const primaryJobs = [
      ...seedQueries.map(searchWikidataCandidates),
      ...queries.flatMap(query => [searchAniListCandidates(query), searchJikanCandidates(query)]),
    ];
    const primary = await Promise.allSettled(primaryJobs);
    let candidates = uniqueCandidates(primary.flatMap(result => result.status === "fulfilled" ? result.value : []));
    if (candidates[0]?.score >= 0.9) return candidates;

    const fallback = await searchWebMalCandidates(baseQueries[0]).catch(() => []);
    return uniqueCandidates([...candidates, ...fallback]);
  }

  function saveMalChoice(candidate) {
    const cache = storeGet(MAL_CACHE_KEY, {});
    const sharedKey = getSharedTitleKey();
    const value = Object.assign(compactCandidate(candidate), {
      time: Date.now(),
      selected: true,
      siteTitle: adapter.getTitle(),
      siteTitleKey: normalizeTitle(adapter.getTitle()),
      seriesKey: getSeriesKey(),
      sharedKey,
      resolvedTitleKey: normalizeTitle(adapter.getTitle()),
      resolvedSeason: getActiveSeasonNumber(),
      resolvedYear: Number(adapter.getPageYear()) || 0,
    });
    cache[getSeriesKey()] = value;
    if (sharedKey) cache[sharedKey] = value;
    const entries = Object.entries(cache);
    if (entries.length > 250) {
      entries.sort((a, b) => Number(b[1]?.time || 0) - Number(a[1]?.time || 0));
      Object.keys(cache).forEach(key => delete cache[key]);
      entries.slice(0, 250).forEach(([key, entry]) => { cache[key] = entry; });
    }
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
    const current = getMalCacheEntry(storeGet(MAL_CACHE_KEY, {}))?.id || "";
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
    const current = getMalCacheEntry(storeGet(MAL_CACHE_KEY, {}))?.id;
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
    const cache = storeGet(MAL_CACHE_KEY, {});
    const cached = getMalCacheEntry(cache);
    const activeSeason = getActiveSeasonNumber();
    const cachedSeason = detectSeasonNumber([cached?.title, cached?.originalTitle, cached?.description].filter(Boolean).join(" "));
    const cachedSeasonMatches = !activeSeason || !cachedSeason || cachedSeason === activeSeason;
    if (cached?.id && cachedSeasonMatches && Date.now() - cached.time < 180 * 24 * 60 * 60 * 1000) {
      if (!cache[getSeriesKey()] || (getSharedTitleKey() && !cache[getSharedTitleKey()])) saveMalChoice(cached);
      return cached.id;
    }

    notify("正在搜尋作品 ID...", 5000);
    const candidates = await findMalCandidates();
    const best = candidates[0];
    const runnerUp = candidates[1];
    const trustedDirectMatch = best?.source === "ACG Secrets → MAL" && best.score >= 1.5;
    const unambiguousMatch = best?.score >= 1.15 && (!runnerUp || best.score - runnerUp.score >= 0.18);
    if (best && (trustedDirectMatch || unambiguousMatch)) {
      saveMalChoice(best);
      return best.id;
    }
    return chooseMalCandidate(false, candidates);
  }

  async function loadAnimeSkipRanges(duration) {
    if (!config.animeSkipClientId) return [];
    const malId = await resolveMalId();
    const episode = Number(adapter.getEpisodeNumber());
    if (!malId || !episode || !Number.isFinite(duration)) return [];
    const cache = storeGet(SKIP_CACHE_KEY, {});
    const cacheKey = `anime-skip:${malId}:${episode}:${Math.round(duration)}`;
    const cached = readSkipCache(cache, cacheKey);
    if (cached !== null) return cached;
    const aniList = await postJson("https://graphql.anilist.co", {
      query: "query ($id: Int!) { Media(idMal: $id, type: ANIME) { id } }", variables: { id: malId },
    });
    const aniListId = aniList?.data?.Media?.id;
    if (!aniListId) return [];
    const data = await postAnimeSkip(
      "query ($id: String!) { findShowsByExternalId(service: ANILIST, serviceId: $id) { episodes { season number timestamps { at type { name } } } } }",
      { id: String(aniListId) }
    );
    const season = String(getActiveSeasonNumber() || "");
    const candidates = (data?.findShowsByExternalId || []).flatMap(show => show.episodes || [])
      .filter(item => Number(item.number) === episode && (!season || !item.season || String(item.season) === season))
      .sort((a, b) => (b.timestamps?.length || 0) - (a.timestamps?.length || 0));
    const marks = (candidates[0]?.timestamps || []).map(item => ({ at: Number(item.at), type: item.type?.name || "" }))
      .filter(item => Number.isFinite(item.at)).sort((a, b) => a.at - b.at);
    const ranges = [];
    for (const [label, type] of [["Intro", "intro"], ["Credits", "outro"]]) {
      const startIndex = marks.findIndex(item => item.type === label);
      if (startIndex < 0) continue;
      const end = marks.slice(startIndex + 1).find(item => ["Canon", "Must Watch", "Preview"].includes(item.type))?.at ?? duration;
      if (end > marks[startIndex].at) ranges.push({ type, start: marks[startIndex].at, end, source: "Anime Skip" });
    }
    writeSkipCache(cache, cacheKey, ranges);
    return ranges;
  }

  async function loadAniSkipRanges(duration) {
    const malId = await resolveMalId();
    const episode = adapter.getEpisodeNumber();
    if (!malId || !episode || !duration || !Number.isFinite(duration)) return [];

    const cache = storeGet(SKIP_CACHE_KEY, {});
    const cacheKey = `${malId}:${episode}:${Math.round(duration)}`;
    const cached = readSkipCache(cache, cacheKey);
    if (cached !== null) return cached;

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

    writeSkipCache(cache, cacheKey, ranges);
    return ranges;
  }

  async function loadBahaSkipRanges() {
    if (adapter.id !== "gamer" || typeof adapter.getEpisodeId !== "function") return [];
    const sn = adapter.getEpisodeId();
    if (!sn) return [];

    const cache = storeGet(SKIP_CACHE_KEY, {});
    const cacheKey = `baha:${sn}`;
    const cached = readSkipCache(cache, cacheKey);
    if (cached !== null) return cached;

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
        writeSkipCache(cache, cacheKey, ranges);
        return ranges;
      } catch (_) {}
    }
    writeSkipCache(cache, cacheKey, []);
    return [];
  }

  function mergeSkipRanges(primary, fallback) {
    const result = [];
    for (const type of ["intro", "outro"]) {
      const range = primary.find(item => item.type === type) || fallback.find(item => item.type === type);
      if (range) result.push(range);
    }
    return result;
  }

  async function loadSkipRanges(duration) {
    const animeSkipRanges = await loadAnimeSkipRanges(duration).catch(() => []);
    const bahaRanges = await loadBahaSkipRanges();
    const preferred = mergeSkipRanges(animeSkipRanges, bahaRanges);
    if (preferred.length === 2) return preferred;
    const aniSkipRanges = await loadAniSkipRanges(duration).catch(() => []);
    return mergeSkipRanges(preferred, aniSkipRanges);
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

  function theaterModeButton() {
    return Array.from(document.querySelectorAll("button"))
      .find(button => /^(?:劇院|一般)模式\s*\(T\)$/.test(button.title || button.textContent.trim()));
  }

  function currentViewingMode() {
    const video = adapter.findVideo();
    const full = document.fullscreenElement || document.webkitFullscreenElement;
    if (full && video && (full === video || full.contains(video))) return "fullscreen";
    if (theaterModeButton()?.title?.startsWith("一般模式")) return "theater";
    return "normal";
  }

  function rememberViewingMode() {
    if (adapter.id === "gamer") sessionStorage.setItem(VIEW_MODE_FLAG, currentViewingMode());
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

  async function goToNext(nextUrl) {
    if (!nextUrl) {
      notify("找不到下一集");
      return;
    }
    if (!await ensureGamerQuizAnswered()) return;
    rememberViewingMode();
    location.assign(nextUrl);
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
    if (adapter.pauseBeforeSeek) {
      const player = getVideoJsPlayer(video);
      try { player?.pause?.(); } catch (_) {}
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

  async function restoreViewingMode() {
    if (adapter.id !== "gamer") return;
    const mode = sessionStorage.getItem(VIEW_MODE_FLAG);
    sessionStorage.removeItem(VIEW_MODE_FLAG);
    if (!mode || mode === "normal") return;
    const video = await waitForEpisodeVideo(22000);
    if (!video) return;
    if (mode === "theater" || mode === "fullscreen") {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const button = theaterModeButton();
        if (button?.title?.startsWith("一般模式")) return;
        if (button?.title?.startsWith("劇院模式")) {
          button.click();
          return;
        }
        await sleep(250);
      }
      return;
    }
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
      if (video.paused || !config.skipEnabled) return;
      if (!ranges && video.currentTime < 3) return;
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
    const iStatus = mkInput("text", config.statusHotkey); hotkeyInput(iStatus);
    const iSettings = mkInput("text", config.settingsHotkey); hotkeyInput(iSettings);
    const iSkipEnabled = mkInput("checkbox", config.skipEnabled);
    const iAnimeSkipClientId = mkInput("password", config.animeSkipClientId, { autocomplete: "off", placeholder: "留空則不使用 Anime Skip" });
    const iIntroOffset = mkInput("number", adjust.introOffset, { min: -120, max: 120, step: 0.5 });
    const iOutroOffset = mkInput("number", adjust.outroOffset, { min: -120, max: 120, step: 0.5 });
    const iJumpEnded = mkInput("checkbox", config.jumpWhenEnded);
    const iAutoQuiz = mkInput("checkbox", config.autoAnswerGamerQuiz);

    const form = document.createElement("form");
    form.append(
      heading("快捷鍵"),
      field("下一集", iNext),
      field("顯示當前作品狀態", iStatus),
      field("開啟設定", iSettings),
      heading("跳過資料來源"),
      check("啟用自動跳過片頭/片尾", iSkipEnabled),
      field("Anime Skip Client ID（本機儲存，可留空）", iAnimeSkipClientId),
      heading(`本作微調：${adapter.getTitle() || adapter.name}`),
      field("片頭整段偏移（正數延後，負數提前）", iIntroOffset),
      field("片尾整段偏移（正數延後，負數提前）", iOutroOffset),
      heading("下一集"),
      check("影片自然結束後自動下一集", iJumpEnded)
    );
    form.append(
      heading("動畫瘋每日問答"),
      check("自動答題（找不到可靠答案時阻止自動跳集）", iAutoQuiz)
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
        statusHotkey: normalizeHotkey(iStatus.value) || defaults.statusHotkey,
        settingsHotkey: normalizeHotkey(iSettings.value) || defaults.settingsHotkey,
        skipEnabled: iSkipEnabled.checked,
        animeSkipClientId: iAnimeSkipClientId.value.trim(),
        jumpWhenEnded: iJumpEnded.checked,
        autoAnswerGamerQuiz: iAutoQuiz.checked,
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
    if (!ranges?.length) return ["跳過資料：沒有資料"];
    const intro = ranges.find(r => r.type === "intro");
    const outro = ranges.find(r => r.type === "outro");
    const parts = [];
    if (intro) parts.push(`片頭 ${formatTime(intro.start)}–${formatTime(intro.end)}`);
    if (outro) parts.push(`片尾 ${formatTime(outro.start)}–${formatTime(outro.end)}`);
    const sources = [...new Set(ranges.map(range => range.source).filter(Boolean))];
    return [`資料：${sources.join(" + ") || "未知"}｜${parts.length ? parts.join("｜") : "有資料"}`];
  }

  function describeAdjust(adjust) {
    const parts = [];
    if (adjust.introOffset) parts.push(`片頭 ${adjust.introOffset > 0 ? "+" : ""}${adjust.introOffset} 秒`);
    if (adjust.outroOffset) parts.push(`片尾 ${adjust.outroOffset > 0 ? "+" : ""}${adjust.outroOffset} 秒`);
    return parts.length ? [`時間校正: ${parts.join("｜")}`] : [];
  }

  function getCachedCurrentSkipRanges(duration, malId) {
    const cache = storeGet(SKIP_CACHE_KEY, {});
    const episode = Number(adapter.getEpisodeNumber());
    const roundedDuration = Math.round(Number(duration));
    let animeSkipRanges = null;
    let bahaRanges = null;
    let aniSkipRanges = null;

    if (adapter.id === "gamer" && typeof adapter.getEpisodeId === "function") {
      const sn = adapter.getEpisodeId();
      if (sn) bahaRanges = readSkipCache(cache, `baha:${sn}`);
    }
    if (malId && episode && Number.isFinite(roundedDuration)) {
      animeSkipRanges = readSkipCache(cache, `anime-skip:${malId}:${episode}:${roundedDuration}`);
      aniSkipRanges = readSkipCache(cache, `${malId}:${episode}:${roundedDuration}`);
    }

    if ([animeSkipRanges, bahaRanges, aniSkipRanges].every(entry => entry === null)) return null;
    const preferred = mergeSkipRanges(animeSkipRanges || [], bahaRanges || []);
    return mergeSkipRanges(preferred, aniSkipRanges || []);
  }

  async function showCurrentStatus() {
    const cache = storeGet(MAL_CACHE_KEY, {});
    const cached = getMalCacheEntry(cache);
    const malId = cached?.id || 0;
    const video = adapter.findVideo();
    const duration = Number(video?.duration);
    const episode = adapter.getEpisodeNumber();
    const season = getActiveSeasonNumber();
    const displayedEpisode = adapter.getDisplayedEpisodeNumber?.() || 0;
    const progress = [season ? `第 ${season} 季` : "", episode ? `第 ${episode} 集` : "集數不明"]
      .filter(Boolean)
      .join("・");
    const displayedNote = displayedEpisode && displayedEpisode !== episode ? `（站內第 ${displayedEpisode} 集）` : "";
    const lines = [
      "當前作品",
      "",
      adapter.getTitle() || "標題不明",
      `${progress}${displayedNote}`,
      `MAL: ${malId || "尚未確認"}${cached?.title ? `｜${cached.title}` : ""}`,
    ];

    const adjustLines = describeAdjust(loadAdjust());
    if (adjustLines.length) lines.push("", ...adjustLines);
    lines.push("");

    if (!episode) {
      lines.push("AniSkip: 無法判斷集數");
    } else if (!video) {
      lines.push("AniSkip: 找不到播放器");
    } else if (!isEpisodeVideo(video)) {
      lines.push(`AniSkip: 正片尚未載入或目前是廣告/提示片段（duration=${Number.isFinite(duration) ? duration.toFixed(1) : "未知"}）`);
    } else {
      const ranges = getCachedCurrentSkipRanges(duration, malId);
      if (ranges === null) {
        lines.push("跳過資料：背景載入中，稍後再查看");
        void loadSkipRanges(duration).catch(() => []);
      } else {
        lines.push(...describeAniSkipRanges(ranges));
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
        [config.statusHotkey, () => showCurrentStatus().catch(err => alert(`查詢失敗：${err.message || err}`))],
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
    GM_registerMenuCommand("查看動畫瘋每日問答狀態", () => showGamerQuizStatus().catch(err => alert(`查詢失敗：${err.message || err}`)));
    GM_registerMenuCommand("選擇/切換作品 ID", switchMalCandidate);
    GM_registerMenuCommand("手動輸入作品 ID", inputManualMalId);
  }

  function getAdapter() {
    return location.hostname === "ani.gamer.com.tw" ? createGamerAdapter() : null;
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

    function seasonRanges() {
      const text = document.body?.innerText || "";
      const ranges = [];
      const pattern = /第\s*([一二三四五六七八九十\d]+)\s*(?:季|期)\s*[：:]\s*第\s*(\d+)\s*[-–—~～至到]\s*(\d+)\s*集([^※\n]{0,80})/g;
      let match;
      while ((match = pattern.exec(text))) {
        const season = parseChineseNumber(match[1]);
        const start = Number(match[2]);
        const end = Number(match[3]);
        if (season > 0 && start > 0 && end >= start && !ranges.some(item => item.season === season)) {
          const year = Number((match[4].match(/(20\d{2}|19\d{2})\s*年/) || [])[1]) || 0;
          ranges.push({ season, start, end, year });
        }
      }
      return ranges;
    }

    function currentSeasonRange() {
      const displayed = displayedEpisodeNumber();
      return seasonRanges().find(item => displayed >= item.start && displayed <= item.end) || null;
    }

    return {
      id: "gamer",
      name: "巴哈姆特動畫瘋",
      minEpisodeDuration: 300,
      keepSkipPopupOutOfPlayer: true,
      nativeFullscreenSkipNotice: true,
      seekPaddingSeconds: 0.25,
      pauseBeforeSeek: false,
      resumeAfterSeekDelay: 320,
      getTitle() {
        return titleText();
      },
      getEpisodeNumber() {
        const displayed = displayedEpisodeNumber();
        const range = currentSeasonRange();
        if (range) return displayed - range.start + 1;
        const items = episodeItems();
        const currentSn = this.getEpisodeId();
        const relative = relativeEpisodeFromList(items, currentSn, displayed);
        if (relative) return relative;
        if (displayed > 40 && getSeasonNumber(this.getTitle()) > 1) return 0;
        return isRegularEpisodeDisplay(displayed) ? displayed : 0;
      },
      getDisplayedEpisodeNumber() {
        return displayedEpisodeNumber();
      },
      getSeasonNumber() {
        return currentSeasonRange()?.season || getSeasonNumber(this.getTitle()) || 0;
      },
      getEpisodeId() {
        return episodeIdFromUrl();
      },
      getSeriesKey() {
        return `title:${normalizeTitle(this.getTitle())}`;
      },
      getPageYear() {
        const seasonalYear = currentSeasonRange()?.year;
        if (seasonalYear) return seasonalYear;
        const premiereRows = Array.from(document.querySelectorAll(".data-file .type, .data-file li"));
        const premiereRow = premiereRows.find(row => /首播日期/.test(row.textContent || ""));
        const premiereText = premiereRow?.querySelector(".content")?.textContent || premiereRow?.textContent || "";
        const premiereYear = Number((premiereText.match(/\b(20\d{2}|19\d{2})\b/) || [])[1]);
        if (Number.isFinite(premiereYear)) return premiereYear;
        const text = document.body?.innerText || "";
        const year = Number((text.match(/年份[:：]\s*(20\d{2}|19\d{2})/) || [])[1]);
        if (Number.isFinite(year)) return year;
        // 動畫瘋目前多以「首播日期／上架時間」呈現，未必有「年份」欄位。
        const datedYear = Number((text.match(/\b(20\d{2}|19\d{2})[\/.\-]\d{1,2}[\/.\-]\d{1,2}/) || [])[1]);
        return Number.isFinite(datedYear) ? datedYear : 0;
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
  ensureGamerQuizAnswered().catch(() => {});
  restoreViewingMode();
})();
