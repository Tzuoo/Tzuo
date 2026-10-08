// ==UserScript==
// @name         禁漫天堂
// @namespace    codex.local
// @version      5.4.0
// @updateURL    https://raw.githubusercontent.com/Tzuoo/Tzuo/main/%E6%B2%B9%E7%8C%B4%E8%85%B3%E6%9C%AC/%E7%A6%81%E6%BC%AB%E5%A4%A9%E5%A0%82.user.js
// @downloadURL  https://raw.githubusercontent.com/Tzuoo/Tzuo/main/%E6%B2%B9%E7%8C%B4%E8%85%B3%E6%9C%AC/%E7%A6%81%E6%BC%AB%E5%A4%A9%E5%A0%82.user.js
// @description  禁漫天堂帳號漫畫收藏書架，保留每部作品最新收藏並自動清理舊集收藏。
// @match        https://18comic.vip/*
// @match        https://*.18comic.vip/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const LIBRARY_CACHE_KEY = 'jm-reader-library-cache-v8';
  const SERIES_CACHE_KEY = 'jm-library-official-series-v1';
  const SERIES_CACHE_TTL = 24 * 60 * 60 * 1000;
  const LIBRARY_CACHE_TTL = 10 * 60 * 1000;
  const LIBRARY_REFRESH_DELAYS = [1200, 3200];
  const COMPLETED_KEY_PREFIX = 'jm-library-completed-v1:';
  let libraryTab = 'reading';

  let libraryLoaded = false;
  let libraryLoading = false;
  let libraryRemoving = false;
  let libraryNotice = '';
  let libraryData = { username: '', favorites: [] };
  let libraryCachedAt = 0;

  try {
    const cached = JSON.parse(localStorage.getItem(LIBRARY_CACHE_KEY) || 'null');
    if (cached?.data?.username && Array.isArray(cached.data.favorites)) {
      libraryData = cached.data;
      libraryCachedAt = Number(cached.savedAt) || 0;
      libraryLoaded = true;
    }
  } catch {}

  const style = document.createElement('style');
  style.textContent = `
    #jm-library-button {
      position:fixed; right:14px; bottom:14px; z-index:2147483646;
      border:0; border-radius:9px; padding:9px 12px;
      background:rgba(20,20,20,.9); color:#fff; box-shadow:0 3px 15px #0006;
      font:14px/1.2 system-ui,sans-serif; cursor:pointer;
    }
    #jm-library-button:hover { background:#333; color:#ffd35a; }
    #jm-library-overlay {
      display:none; position:fixed; inset:0; z-index:2147483647; padding:16px;
      align-items:center; justify-content:center; background:#000a;
    }
    #jm-library-overlay.open { display:flex; }
    #jm-library-dialog {
      width:min(680px,100%); max-height:calc(100vh - 32px); overflow:hidden;
      border-radius:12px; background:#252525; color:#fff;
      font:15px/1.4 system-ui,sans-serif;
      box-shadow:0 8px 35px #0009;
    }
    #jm-library-dialog header {
      display:flex; align-items:center; justify-content:space-between;
      padding:14px 16px;
    }
    #jm-library-dialog h2 { margin:0; font-size:21px; }
    #jm-library-dialog header button {
      border:0; background:transparent; color:#fff;
      font-size:28px; cursor:pointer;
    }
    [data-library-role="status"] { padding:12px 15px; color:#bbb; }
    [data-library-role="list"] { max-height:55vh; overflow:auto; }
    .jm-library-item {
      display:block; padding:10px 15px;
      border-top:1px solid #3c3c3c;
      color:#fff; text-decoration:none;
    }
    .jm-library-item:hover { background:#333; color:#ffd35a; }
    .jm-library-row { display:flex; align-items:center; border-top:1px solid #3c3c3c; }
    .jm-library-row .jm-library-item { flex:1; min-width:0; border-top:0; }
    .jm-library-title { display:-webkit-box; -webkit-box-orient:vertical;
      -webkit-line-clamp:2; overflow:hidden; overflow-wrap:anywhere; }
    .jm-library-tabs { display:flex; gap:8px; padding:0 15px 8px; }
    .jm-library-tabs button, .jm-library-toggle {
      border:1px solid #555; border-radius:6px; background:#333; color:#ddd;
      padding:6px 9px; cursor:pointer; font:inherit;
    }
    .jm-library-tabs button[aria-selected="true"] { color:#ffd35a; border-color:#ffd35a; }
    .jm-library-toggle { flex-shrink:0; margin-right:12px; font-size:12px; }
    .jm-library-remove { color:#ffaaaa; border-color:#805050; }
    .jm-library-toggle:disabled { opacity:.5; cursor:wait; }
    #jm-library-dialog footer {
      padding:12px 15px; border-top:1px solid #444; text-align:right;
    }
    #jm-library-dialog footer a { color:#ffd35a; }
    @media(max-width:600px) {
      #jm-library-button { right:6px; bottom:6px; }
    }
  `;
  document.head.appendChild(style);

  const libraryButton = document.createElement('button');
  libraryButton.id = 'jm-library-button';
  libraryButton.type = 'button';
  libraryButton.textContent = '★ 書架';
  document.body.appendChild(libraryButton);

  const libraryOverlay = document.createElement('div');
  libraryOverlay.id = 'jm-library-overlay';
  libraryOverlay.innerHTML = `
    <section id="jm-library-dialog"
             role="dialog"
             aria-modal="true"
             aria-label="我的書架">
      <header>
        <h2>我的書架</h2>
        <button type="button"
                data-library-action="close"
                aria-label="關閉">×</button>
      </header>

      <div data-library-role="status">讀取中…</div>
      <div class="jm-library-tabs" role="tablist" aria-label="收藏分類">
        <button type="button" role="tab" data-library-tab="reading">閱讀中</button>
        <button type="button" role="tab" data-library-tab="completed">已完結</button>
      </div>
      <div data-library-role="list"></div>

      <footer>
        <a data-library-role="official"
           href="/user/">前往網站完整頁面</a>
      </footer>
    </section>
  `;
  document.body.appendChild(libraryOverlay);

  /*
   * 不直接使用頁面可能被修改/包裝過的 fetch。
   * 使用原生 XMLHttpRequest 取得網站頁面。
   */
  function request(url, options = {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.open(options.method || 'GET', url, true);
      xhr.withCredentials = true;

      for (const [name, value] of Object.entries(options.headers || {})) {
        xhr.setRequestHeader(name, value);
      }

      xhr.onload = () => {
        const status = Number(xhr.status) || 0;

        if (status >= 200 && status < 300) {
          resolve({
            status,
            text: xhr.responseText || '',
            contentType: xhr.getResponseHeader('content-type') || ''
          });
        } else {
          reject(new Error(`HTTP ${status || '未知'}：${url}`));
        }
      };

      xhr.onerror = () => {
        reject(new Error(`網路請求失敗：${url}`));
      };

      xhr.ontimeout = () => {
        reject(new Error(`請求逾時：${url}`));
      };

      xhr.timeout = 15000;
      xhr.send(options.body ?? null);
    });
  }

  async function fetchDocument(url) {
    const response = await request(url);

    const doc = new DOMParser().parseFromString(
      response.text,
      'text/html'
    );

    if (!doc?.documentElement) {
      throw new Error(`網站頁面解析失敗：${url}`);
    }

    return doc;
  }

  function extractUsername(doc) {
    const ignored = new Set([
      'avatar',
      'edit',
      'login',
      'logout',
      'register',
      'favorite',
      'favorites',
      'history',
      'setting',
      'settings'
    ]);

    const candidates = [
      ...doc.querySelectorAll('a[href*="/user/"]'),
      ...doc.querySelectorAll('[data-href*="/user/"]')
    ];

    for (const node of candidates) {
      const href =
        node.getAttribute('href') ||
        node.getAttribute('data-href') ||
        '';

      const match = href.match(/\/user\/([^/?#]+)(?:\/|$)/);

      if (!match) continue;

      const username = decodeURIComponent(match[1] || '').trim();

      if (
        username &&
        !ignored.has(username.toLowerCase())
      ) {
        return username;
      }
    }

    const html = doc.documentElement?.innerHTML || '';

    const fallback = html.match(
      /\/user\/([^"'?#/<>\s]+)\/favorite(?:\/|["'])/i
    );

    return fallback
      ? decodeURIComponent(fallback[1])
      : '';
  }

  function normalizeSeriesTitle(title) {
    const key = String(title)
      .normalize('NFKC')
      // 只統一已知字形差異，不用部分標題或模糊比對刪除收藏。
      .replace(/獵/g, '猎')
      .replace(/話/g, '话')
      .replace(/[-\s]*第\s*\d+(?:\.\d+)?\s*[话回章集].*$/u, '')
      .replace(
        /(?:第\s*)?\d+(?:\.\d+)?(?:\s*[-~～至]\s*\d+(?:\.\d+)?)?\s*$/u,
        ''
      )
      .replace(/[\s\-_／/]+/g, '')
      .toLowerCase();
    return canonicalSeriesKey(key);
  }

  function canonicalSeriesKey(key) {
    // 使用者確認 photo/1453521（90話）與 photo/1248468（64話）為同作。
    // 僅對這組完整別名及其重複標題做對應，不採模糊前綴刪除。
    const aliases = ['缺德鄰居麥相害', '缺德鄰居難相處', '缺德鄰居難相处',
      '缺德邻居麦相害', '缺德邻居难相处'];
    if (aliases.includes(key) || aliases.some(a => aliases.some(b => key === a + b))) {
      return '缺德鄰居難相处';
    }
    return key;
  }

  function extractChapterNumber(title) {
    const text = String(title).normalize('NFKC');
    const match = text.match(/第\s*(\d+(?:\.\d+)?)\s*[話话回章集]/u) ||
      text.match(/(\d+(?:\.\d+)?)(?:\s*[-~～至]\s*(\d+(?:\.\d+)?))?\s*$/u);
    return match ? Number(match[2] || match[1]) : 0;
  }

  function completionStorageKey() {
    return COMPLETED_KEY_PREFIX + encodeURIComponent(libraryData.username);
  }

  function readCompletedTitles() {
    try {
      const value = JSON.parse(localStorage.getItem(completionStorageKey()) || '[]');
      return new Set(Array.isArray(value) ? value.filter(key => typeof key === 'string').map(canonicalSeriesKey) : []);
    } catch { return new Set(); }
  }

  function completionKey(item) {
    return item.seriesId ? `series:${item.seriesId}` : normalizeSeriesTitle(item.title) || `album:${item.id}`;
  }

  function extractOfficialSeries(doc, expectedId) {
    // 只讀網站資料，絕不執行頁面內的 JavaScript。
    const source = [...doc.querySelectorAll('script:not([src])')]
      .map(node => node.textContent || '').find(text => /\bvar\s+series_id\s*=/.test(text) && /\bvar\s+aid\s*=/.test(text));
    if (!source) return null;
    const value = name => (source.match(new RegExp(`\\bvar\\s+${name}\\s*=\\s*(\\d+(?:\\.\\d+)?)\\s*;`)) || [])[1];
    const seriesId = value('series_id'), aid = value('aid'), sort = Number(value('sort'));
    const hidden = doc.querySelector('input#series_id')?.getAttribute('value');
    if (!seriesId || seriesId === '0' || aid !== String(expectedId) || !(sort > 0) || (hidden && hidden !== seriesId)) return null;
    const chapters = [...doc.querySelectorAll('.series_drop a.series_drop_item[href]')].map(link => {
      try {
        const url = new URL(link.getAttribute('href'), location.origin);
        const id = url.pathname.match(/^\/photo\/(\d+)\/?$/)?.[1];
        return url.origin === location.origin && id ? id : null;
      } catch { return null; }
    });
    // 僅清單順序與本頁官方 sort 相符時，才將清單順序共用給其他章節。
    const listValid = chapters.length > 0 && chapters.every(Boolean) &&
      new Set(chapters).size === chapters.length && chapters.indexOf(aid) + 1 === sort;
    return { seriesId, sort, chapters: listValid ? chapters : [] };
  }

  async function resolveOfficialFavorites(items) {
    let cache = {};
    try { cache = JSON.parse(localStorage.getItem(SERIES_CACHE_KEY) || '{}') || {}; } catch {}
    const resolved = new Map();
    const valid = entry => entry && /^\d+$/.test(entry.seriesId) && Number(entry.sort) > 0 &&
      Number(entry.savedAt) > Date.now() - SERIES_CACHE_TTL;
    for (const item of items) {
      if (resolved.has(item.id)) continue;
      if (valid(cache[item.id])) { resolved.set(item.id, cache[item.id]); continue; }
      try {
        const doc = await fetchDocument(`/photo/${item.id}`);
        const info = extractOfficialSeries(doc, item.id);
        if (!info) continue;
        const savedAt = Date.now();
        const remember = (id, sort) => {
          const entry = { seriesId: info.seriesId, sort, savedAt };
          // 相互矛盾的官方對應不可自動合併。
          if (valid(cache[id]) && cache[id].seriesId !== info.seriesId) {
            resolved.set(id, null); delete cache[id]; return;
          }
          cache[id] = entry; resolved.set(id, entry);
        };
        remember(item.id, info.sort);
        info.chapters.forEach((id, index) => remember(id, index + 1));
      } catch { /* 查詢失敗的收藏保留，下一次重新嘗試。 */ }
    }
    cache = Object.fromEntries(Object.entries(cache).filter(([, entry]) => valid(entry)).slice(-2000));
    try { localStorage.setItem(SERIES_CACHE_KEY, JSON.stringify(cache)); } catch {}
    return items.map(item => {
      const info = resolved.get(item.id);
      return { ...item, seriesId: info?.seriesId || '', seriesSort: Number(info?.sort) || 0,
        seriesKey: info ? `series:${info.seriesId}` : `album:${item.id}` };
    });
  }

  function migrateCompletedSeries(username, items) {
    const key = COMPLETED_KEY_PREFIX + encodeURIComponent(username);
    try {
      const original = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(original)) return;
      const completed = new Set(original.filter(value => typeof value === 'string').map(canonicalSeriesKey));
      for (const item of items) {
        const oldKey = normalizeSeriesTitle(item.title);
        if (item.seriesId && completed.has(oldKey)) {
          completed.add(`series:${item.seriesId}`); completed.delete(oldKey);
        }
      }
      localStorage.setItem(key, JSON.stringify([...completed]));
    } catch { /* 儲存不可用時不清除原分類。 */ }
  }

  function extractAlbums(doc) {
    const seen = new Set();

    /*
     * 僅讀收藏卡片，禁止退回全頁連結，避免導覽／隨便看混入。
     */
    const albumLinks = [
      ...doc.querySelectorAll(
        '.panel-body .list-col a[href*="/album/"]'
      ),
      ...doc.querySelectorAll(
        '.list-col a[href*="/album/"]'
      )
    ].filter(
      (link, index, all) => all.indexOf(link) === index
    );

    const items = albumLinks.flatMap((link, index) => {
      if (link.closest('nav, header, footer, .navbar, .dropdown-menu')) return [];
      const url = new URL(
        link.getAttribute('href'),
        location.origin
      );

      const match = url.pathname.match(
        /^\/album\/(\d+)\/?$/
      );

      const title = (
        link.getAttribute('title') ||
        link.querySelector('img')?.getAttribute('alt') ||
        link.querySelector('[title]')?.getAttribute('title') ||
        link.textContent ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim();

      if (
        !match ||
        !title ||
        /^(?:隨便看|随便看)$/u.test(title) ||
        seen.has(match[1])
      ) {
        return [];
      }

      seen.add(match[1]);

      return [{
        id: match[1],
        title,
        url: `/photo/${match[1]}`,
        seriesSort: 0,
        index,
        seriesKey: `album:${match[1]}`
      }];
    });

    return { favorites: items, obsoleteIds: [] };
  }

  function selectNewestOfficial(items) {
    const highestBySeries = new Map();
    const obsoleteIds = [];
    for (const item of items) {
      if (item.seriesId && item.seriesSort > 0) {
        highestBySeries.set(item.seriesId, Math.max(highestBySeries.get(item.seriesId) || 0, item.seriesSort));
      }
    }
    const favorites = items.filter(item => {
      const obsolete = item.seriesId && item.seriesSort > 0 && item.seriesSort < highestBySeries.get(item.seriesId);
      if (obsolete) obsoleteIds.push(item.id);
      return !obsolete;
    })
      .sort((a, b) => a.index - b.index)
      .map(
        ({
          seriesKey: _seriesKey,
          seriesSort: _seriesSort,
          index: _index,
          ...item
        }) => item
      );

    return {
      favorites,
      obsoleteIds: [
        ...new Set(obsoleteIds)
      ]
    };
  }

  async function removeOfficialFavorite(albumId) {
    const response = await request(
      '/ajax/remove_album_playlist',
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded;charset=UTF-8',

          'X-Requested-With':
            'XMLHttpRequest'
        },

        body: new URLSearchParams({
          video_id: String(albumId),
          list: 'favorites'
        }).toString()
      }
    );

    let result;

    try {
      result = JSON.parse(response.text);
    } catch {
      throw new Error(
        `刪除收藏失敗：網站回傳格式異常（${albumId}）`
      );
    }

    if (String(result?.status) !== '1') {
      throw new Error(
        result?.msg ||
        `刪除收藏失敗（${albumId}）`
      );
    }
  }

  async function removeObsoleteFavorites(albumIds) {
    let removed = 0;

    for (const albumId of albumIds) {
      await removeOfficialFavorite(albumId);
      removed += 1;
    }

    return removed;
  }

  async function loadLibrary(force = false) {
    const cacheFresh =
      libraryLoaded &&
      Date.now() - libraryCachedAt <
        LIBRARY_CACHE_TTL;

    if (
      libraryLoading ||
      libraryRemoving ||
      (cacheFresh && !force)
    ) {
      return;
    }

    libraryLoading = true;
    renderLibrary();

    try {
      /*
       * 先讀帳號頁取得目前登入帳號。
       */
      const profile =
        await fetchDocument('/user/');

      const username =
        extractUsername(profile);

      if (!username) {
        throw new Error(
          '讀不到登入帳號，請先確認網站目前為登入狀態'
        );
      }

      const base =
        `/user/${encodeURIComponent(username)}/favorite`;

      let favoritesDoc;
      let lastError;

      /*
       * 優先讀 /favorite/albums。
       * 若網站路徑改動，再嘗試 /favorite。
       */
      for (const url of [
        `${base}/albums`,
        base
      ]) {
        try {
          const doc =
            await fetchDocument(url);

          const hasAlbumLinks =
            !!doc.querySelector(
              'a[href*="/album/"]'
            );

          const looksLikeFavoritePage =
            hasAlbumLinks ||
            /收藏|favorite|playlist/i.test(
              doc.body?.textContent || ''
            );

          if (looksLikeFavoritePage) {
            favoritesDoc = doc;
            break;
          }
        } catch (error) {
          lastError = error;
        }
      }

      if (!favoritesDoc) {
        throw (
          lastError ||
          new Error('讀不到網站收藏頁')
        );
      }

      const rawItems = extractAlbums(favoritesDoc).favorites;
      // 先顯示收藏，再於背景核對官方關聯；核對期間移除按鈕保持停用。
      libraryData = { username, favorites: rawItems };
      libraryLoaded = true;
      renderLibrary();
      const officialItems = await resolveOfficialFavorites(rawItems);
      migrateCompletedSeries(username, officialItems);
      const extracted = selectNewestOfficial(officialItems);

      // 清理前再核對帳號；失敗時不執行刪除。
      if (extracted.obsoleteIds.length && extractUsername(await fetchDocument('/user/')) !== username) {
        throw new Error('登入帳號已改變，請重新整理後再操作');
      }

      const removedCount =
        await removeObsoleteFavorites(
          extracted.obsoleteIds
        );

      libraryData = {
        username,
        favorites: extracted.favorites,
        removedCount
      };

      libraryLoaded = true;
      libraryCachedAt = Date.now();

      localStorage.setItem(
        LIBRARY_CACHE_KEY,
        JSON.stringify({
          savedAt: libraryCachedAt,
          data: libraryData
        })
      );

    } catch (error) {

      libraryNotice = `更新失敗：${error?.message || String(error)}`;
      if (!libraryLoaded) {
        libraryData = {
          username: '',
          favorites: [],
          error:
            error?.message ||
            String(error)
        };
      }

    } finally {
      libraryLoading = false;
      renderLibrary();
    }
  }

  function renderLibrary() {
    const status =
      libraryOverlay.querySelector(
        '[data-library-role="status"]'
      );

    const list =
      libraryOverlay.querySelector(
        '[data-library-role="list"]'
      );

    const official =
      libraryOverlay.querySelector(
        '[data-library-role="official"]'
      );

    if (
      libraryLoading &&
      !libraryLoaded
    ) {
      status.textContent =
        '正在讀取網站帳號資料…';

      list.replaceChildren();
      return;
    }

    if (libraryData.error) {
      status.textContent =
        libraryData.error;

      list.replaceChildren();

      official.href = '/user/';
      return;
    }

    const allItems = libraryData.favorites || [];
    const completedTitles = readCompletedTitles();
    const completedCount = allItems.filter(item => completedTitles.has(completionKey(item))).length;
    const items = allItems.filter(item =>
      completedTitles.has(completionKey(item)) === (libraryTab === 'completed'));
    for (const tab of libraryOverlay.querySelectorAll('[data-library-tab]')) {
      const completed = tab.dataset.libraryTab === 'completed';
      tab.textContent = `${completed ? '已完結' : '閱讀中'}（${completed ? completedCount : allItems.length - completedCount}）`;
      tab.setAttribute('aria-selected', String(tab.dataset.libraryTab === libraryTab));
    }

    const cleanup =
      libraryData.removedCount
        ? `（已刪除 ${libraryData.removedCount} 筆舊收藏）`
        : '';

    status.textContent =
      `漫畫收藏：${allItems.length} 筆（完結分類僅儲存在本機）` +
      cleanup +
      (
        libraryLoading
          ? '（背景更新中）'
          : ''
      ) + (libraryRemoving ? '（正在移除收藏…）' : '') +
      (libraryNotice ? ` · ${libraryNotice}` : '');

    list.replaceChildren(
      ...items.map(item => {
        const row = document.createElement('div');
        row.className = 'jm-library-row';
        const link =
          document.createElement('a');

        link.className =
          'jm-library-item';

        link.href =
          item.url;

        link.title = item.title;
        const title = document.createElement('span');
        title.className = 'jm-library-title';
        title.textContent = item.title;
        link.appendChild(title);
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'jm-library-toggle';
        toggle.textContent = libraryTab === 'completed' ? '移回閱讀中' : '標記完結';
        toggle.setAttribute('aria-label', `${toggle.textContent}：${item.title}`);
        toggle.addEventListener('click', () => {
          const completed = readCompletedTitles();
          const key = completionKey(item);
          if (completed.has(key)) completed.delete(key);
          else completed.add(key);
          try {
            localStorage.setItem(completionStorageKey(), JSON.stringify([...completed]));
            renderLibrary();
          } catch {
            status.textContent = '無法儲存完結標記，請確認瀏覽器允許本機儲存。';
          }
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'jm-library-toggle jm-library-remove';
        remove.textContent = '移除收藏';
        remove.disabled = libraryLoading || libraryRemoving;
        remove.setAttribute('aria-label', `移除收藏：${item.title}`);
        remove.addEventListener('click', () => removeLibraryItem(item));
        row.append(link, toggle, remove);
        return row;
      })
    );

    if (!items.length) {
      const empty =
        document.createElement('div');

      empty.className =
        'jm-library-item';

      empty.textContent =
        libraryTab === 'completed' ? '尚未標記已完結的作品' : '目前沒有閱讀中的作品';

      list.appendChild(empty);
    }

    official.href =
      libraryData.username
        ? `/user/${encodeURIComponent(
            libraryData.username
          )}/favorite/albums`
        : '/user/';
  }

  async function removeLibraryItem(item) {
    if (libraryLoading || libraryRemoving || !libraryData.username) return;
    if (!window.confirm(`確定從網站收藏移除這本漫畫？\n\n${item.title}\n\n只移除這一本，不會刪除漫畫內容。`)) return;
    const username = libraryData.username;
    libraryRemoving = true;
    libraryNotice = '';
    renderLibrary();
    try {
      const profile = await fetchDocument('/user/');
      if (extractUsername(profile) !== username) {
        throw new Error('登入帳號已改變，請重新整理後再操作');
      }
      await removeOfficialFavorite(item.id);
      libraryData.favorites = libraryData.favorites.filter(book => book.id !== item.id);
      libraryCachedAt = Date.now();
      libraryNotice = '已移除收藏';
      try {
        localStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify({ savedAt: libraryCachedAt, data: libraryData }));
      } catch {
        libraryCachedAt = 0;
        try { localStorage.removeItem(LIBRARY_CACHE_KEY); } catch {}
        libraryNotice = '已移除收藏，但本機快取無法儲存';
      }
    } catch (error) {
      libraryNotice = `移除失敗：${error?.message || String(error)}`;
    } finally {
      libraryRemoving = false;
      renderLibrary();
    }
  }

  function openLibrary() {
    libraryTab = 'reading';
    libraryOverlay.classList.add('open');

    renderLibrary();
    loadLibrary();
  }

  function refreshLibraryAfterFavoriteChange() {
    libraryCachedAt = 0;

    localStorage.removeItem(
      LIBRARY_CACHE_KEY
    );

    for (
      const delay of LIBRARY_REFRESH_DELAYS
    ) {
      window.setTimeout(
        () => loadLibrary(true),
        delay
      );
    }
  }

  libraryButton.addEventListener(
    'click',
    openLibrary
  );

  libraryOverlay.addEventListener(
    'click',
    event => {
      const tab = event.target.closest('[data-library-tab]');
      if (tab) {
        libraryTab = tab.dataset.libraryTab;
        renderLibrary();
        return;
      }
      if (
        event.target === libraryOverlay ||
        event.target.closest(
          '[data-library-action="close"]'
        )
      ) {
        libraryOverlay.classList.remove(
          'open'
        );
      }
    }
  );

  document.addEventListener(
    'keydown',
    event => {
      if (
        event.code === 'Escape' &&
        libraryOverlay.classList.contains(
          'open'
        )
      ) {
        libraryOverlay.classList.remove(
          'open'
        );
      }
    }
  );

  document.addEventListener(
    'click',
    event => {
      const favoriteChange =
        event.target.closest([
          '#f-dir-submit',
          '[id^="favorite_album_"]',
          '[id^="album_favorite_"]',
          '[id^="remove_album_from_favorites_"]'
        ].join(','));

      if (favoriteChange) {
        refreshLibraryAfterFavoriteChange();
      }
    },
    true
  );

  window.setTimeout(
    () => loadLibrary(),
    1200
  );
})();
