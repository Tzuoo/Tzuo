// ==UserScript==
// @name         禁漫天堂
// @namespace    codex.local
// @version      5.3.0
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

  const LIBRARY_CACHE_KEY = 'jm-reader-library-cache-v6';
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
    return String(title)
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
      return new Set(Array.isArray(value) ? value.filter(key => typeof key === 'string') : []);
    } catch { return new Set(); }
  }

  function completionKey(item) {
    return normalizeSeriesTitle(item.title) || `album:${item.id}`;
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

      const seriesSort =
        extractChapterNumber(title) || Number(url.searchParams.get('series_sort')) || 0;

      return [{
        id: match[1],
        title,
        url: `/photo/${match[1]}`,
        seriesSort,
        index,
        seriesKey:
          normalizeSeriesTitle(title) ||
          `album:${match[1]}`
      }];
    });

    const newestBySeries = new Map();
    const obsoleteIds = [];

    for (const item of items) {
      const current =
        newestBySeries.get(item.seriesKey);

      if (!current) {
        newestBySeries.set(
          item.seriesKey,
          item
        );
      } else if (
        item.seriesSort > 0 &&
        current.seriesSort > 0 &&
        item.seriesSort > current.seriesSort
      ) {
        obsoleteIds.push(current.id);

        newestBySeries.set(
          item.seriesKey,
          item
        );
      } else if (
        item.seriesSort > 0 &&
        current.seriesSort > 0 &&
        item.seriesSort < current.seriesSort
      ) {
        obsoleteIds.push(item.id);
      } else {
        // 無法確認話數先後時，保留兩筆，不隱藏或刪除。
        newestBySeries.set(`album:${item.id}`, item);
      }
    }

    const favorites = [
      ...newestBySeries.values()
    ]
      .sort((a, b) => a.index - b.index)
      .map(
        ({
          seriesKey,
          seriesSort,
          index,
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

      const extracted =
        extractAlbums(favoritesDoc);

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
