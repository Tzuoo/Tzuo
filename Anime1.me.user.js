// ==UserScript==
// @name         Anime1.me
// @namespace    https://anime1.me/
// @version      1.2.0
// @description  Hidden Anime1 next-episode hotkey with settings, autoplay-after-jump, fullscreen (F), and skip intro/outro.
// @author       tzuoo
// @match        https://anime1.me/*
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/tzuoo/Tzuo/main/Anime1.me.user.js
// @downloadURL  https://raw.githubusercontent.com/tzuoo/Tzuo/main/Anime1.me.user.js
// @homepageURL  https://tzuoo.github.io/Tzuo/
// ==/UserScript==

(function () {
  "use strict";

  const NEXT_TEXT = "\u4e0b\u4e00\u96c6";
  const SETTINGS_TITLE = "Anime1 \u4e0b\u4e00\u96c6\u8a2d\u5b9a";
  const CONFIG_KEY = "anime1NextEpisodeConfig";
  const AUTOPLAY_FLAG = "anime1NextEpisodeShouldAutoplay";

  const defaults = {
    nextHotkey: "n",
    fullscreenHotkey: "f",
    settingsHotkey: "ctrl+shift+n",
    autoplayAfterJump: true,
    jumpWhenEnded: false,
    countdownSeconds: 0,
    skipIntro: true,
    skipOutro: true,
    introWindow: [0, 240],    // scan first 4 min for OP
    outroWindow: [0.75, 1.0]  // scan last 25% of video for ED
  };

  function loadConfig() {
    try {
      return Object.assign({}, defaults, JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}"));
    } catch (_) {
      return Object.assign({}, defaults);
    }
  }

  function saveConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  let config = loadConfig();

  function normalizeUrl(href) {
    try {
      return new URL(href, window.location.origin).href;
    } catch (_) {
      return "";
    }
  }

  function findNextEpisodeUrl() {
    const links = Array.from(document.querySelectorAll("a[href]"));
    const exact = links.find((link) => link.textContent.trim() === NEXT_TEXT);
    if (exact) return normalizeUrl(exact.getAttribute("href"));

    const loose = links.find((link) => {
      const text = link.textContent.trim();
      return text.includes(NEXT_TEXT) || /next/i.test(text);
    });
    return loose ? normalizeUrl(loose.getAttribute("href")) : "";
  }

  function normalizeHotkey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace("control+", "ctrl+")
      .replace("cmd+", "meta+")
      .replace("command+", "meta+")
      .replace("option+", "alt+")
      .replace("esc", "escape");
  }

  function eventToHotkey(event) {
    const parts = [];
    if (event.ctrlKey) parts.push("ctrl");
    if (event.altKey) parts.push("alt");
    if (event.shiftKey) parts.push("shift");
    if (event.metaKey) parts.push("meta");

    let key = event.key.toLowerCase();
    if (key === " ") key = "space";
    if (!["control", "shift", "alt", "meta"].includes(key)) parts.push(key);
    return parts.join("+");
  }

  function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(tag);
  }

  function markAutoplayWanted() {
    if (config.autoplayAfterJump) sessionStorage.setItem(AUTOPLAY_FLAG, "1");
  }

  function goToNext(nextUrl) {
    if (!nextUrl) {
      notify("\u627e\u4e0d\u5230\u4e0b\u4e00\u96c6\u9023\u7d50");
      return;
    }
    markAutoplayWanted();
    window.location.assign(nextUrl);
  }

  function waitForVideo(timeoutMs) {
    return new Promise((resolve) => {
      const found = document.querySelector("video");
      if (found) {
        resolve(found);
        return;
      }

      const observer = new MutationObserver(() => {
        const video = document.querySelector("video");
        if (video) {
          observer.disconnect();
          resolve(video);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });

      window.setTimeout(() => {
        observer.disconnect();
        resolve(document.querySelector("video"));
      }, timeoutMs);
    });
  }

  async function tryAutoplayIfRequested() {
    if (sessionStorage.getItem(AUTOPLAY_FLAG) !== "1") return;
    sessionStorage.removeItem(AUTOPLAY_FLAG);
    if (!config.autoplayAfterJump) return;

    const video = await waitForVideo(12000);
    if (!video) return;

    const attempts = [
      () => {
        const button = document.querySelector(".vjs-big-play-button");
        if (button) button.click();
      },
      () => {
        if (window.videojs && video.id) {
          const player = window.videojs(video.id);
          if (player && typeof player.play === "function") return player.play();
        }
        return null;
      },
      () => video.play()
    ];

    for (const attempt of attempts) {
      try {
        const result = attempt();
        if (result && typeof result.catch === "function") await result.catch(() => {});
        if (!video.paused) return;
      } catch (_) {
        // Keep trying the next playback path.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 900));
    }
  }

  // ── Fullscreen ──────────────────────────────────────────────────────────────
  function toggleFullscreen() {
    const video = document.querySelector("video");
    const target = video
      ? (video.closest(".vjs-tech") ? video.closest(".video-js") || video : video)
      : document.documentElement;

    if (!document.fullscreenElement) {
      (target.requestFullscreen || target.webkitRequestFullscreen || target.mozRequestFullScreen ||
        target.msRequestFullscreen || (() => {})).call(target);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen ||
        document.msExitFullscreen || (() => {})).call(document);
    }
  }

  // ── Skip Intro / Outro (audio-fingerprint heuristic) ────────────────────────
  // Strategy: sample audio RMS at regular intervals. OP/ED segments tend to be
  // louder/more energetic than silent cold opens. We look for a sustained
  // loud segment in the intro window and a sustained loud segment near the end,
  // then skip the user past them by jumping to the detected end boundary.
  //
  // Because we cannot do true fingerprinting in a userscript, we use a simpler
  // but effective heuristic:
  //   1. Detect a "loud-enough" window of ≥skipDuration seconds.
  //   2. For intro: search between introWindow[0]..introWindow[1] seconds.
  //   3. For outro: search between outroWindow[0]..outroWindow[1] fraction of duration.
  // When found, show a toast with a countdown; the user can dismiss it.

  const SKIP_DURATION_MIN = 60;  // segment must be at least 60 s to be considered OP/ED
  const SKIP_DURATION_MAX = 120; // …but cap at 2 min

  function wireSkipIntroOutro(video) {
    if (!video || video.dataset.anime1SkipAttached === "1") return;
    video.dataset.anime1SkipAttached = "1";

    let audioCtx, analyser, source, skipToastEl, skipTimer;

    function buildAnalyser() {
      if (audioCtx) return;
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source = audioCtx.createMediaElementSource(video);
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
      } catch (_) {
        audioCtx = null;
      }
    }

    function getRMS() {
      if (!analyser) return 0;
      const buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      return Math.sqrt(sum / buf.length);
    }

    // Sliding-window loud detector: returns true if average RMS over last
    // `windowSec` seconds exceeds `threshold`.
    const RMS_THRESHOLD = 0.03;
    const rmsHistory = [];   // { t, rms }

    function sampleRMS() {
      if (!analyser || video.paused) return;
      const now = video.currentTime;
      rmsHistory.push({ t: now, rms: getRMS() });
      // Keep only last 5 s
      while (rmsHistory.length && now - rmsHistory[0].t > 5) rmsHistory.shift();
    }

    let samplingId = null;
    function startSampling() {
      if (samplingId) return;
      samplingId = window.setInterval(sampleRMS, 500);
    }
    function stopSampling() {
      window.clearInterval(samplingId);
      samplingId = null;
    }

    // skipBounds[0]: detected segment start, skipBounds[1]: end to jump to
    let introBounds = null;
    let outroBounds = null;
    let scanDone = false;

    // Rough scan: play silently through the video at 2× speed looking for a
    // ≥ SKIP_DURATION_MIN s block of "loud" audio in the intro/outro windows.
    // We do this once per video after metadata loads.
    async function scanForSegments() {
      if (scanDone || !config.skipIntro && !config.skipOutro) return;
      scanDone = true;

      const dur = video.duration;
      if (!dur || !isFinite(dur)) return;

      buildAnalyser();
      if (!analyser) return; // AudioContext blocked — skip heuristic

      // We scan by jumping and sampling RMS for a few frames at each position
      const SAMPLE_STEP = 5; // seconds between probe points
      const LOUD_FRAMES = 3; // consecutive samples above threshold = loud block

      const introEnd = Math.min(config.introWindow[1], dur * 0.5);
      const outroStart = dur * config.outroWindow[0];

      async function probeAt(t) {
        video.currentTime = t;
        await new Promise(r => video.addEventListener("seeked", r, { once: true }));
        let sum = 0;
        for (let i = 0; i < LOUD_FRAMES; i++) {
          sum += getRMS();
          await new Promise(r => window.setTimeout(r, 120));
        }
        return sum / LOUD_FRAMES;
      }

      // Probe intro window
      if (config.skipIntro && dur > 90) {
        let loudStart = null;
        for (let t = config.introWindow[0]; t <= introEnd; t += SAMPLE_STEP) {
          const rms = await probeAt(t);
          if (rms >= RMS_THRESHOLD) {
            if (loudStart === null) loudStart = t;
            if (t - loudStart >= SKIP_DURATION_MIN) {
              // Found long enough loud block — mark [0, t+SAMPLE_STEP] as intro
              introBounds = [0, Math.min(t + SAMPLE_STEP, introEnd)];
              break;
            }
          } else {
            loudStart = null;
          }
        }
      }

      // Probe outro window
      if (config.skipOutro && dur > 90) {
        let loudStart = null;
        for (let t = outroStart; t <= dur - SAMPLE_STEP; t += SAMPLE_STEP) {
          const rms = await probeAt(t);
          if (rms >= RMS_THRESHOLD) {
            if (loudStart === null) loudStart = t;
            if (t - loudStart >= SKIP_DURATION_MIN) {
              outroBounds = [loudStart, Math.min(loudStart + SKIP_DURATION_MAX, dur - 2)];
              break;
            }
          } else {
            loudStart = null;
          }
        }
      }
    }

    function showSkipToast(label, skipTo, autoSkipAfter) {
      injectStyles();
      if (skipToastEl) skipToastEl.remove();
      window.clearTimeout(skipTimer);

      const toast = document.createElement("div");
      toast.id = "anime1-skip-toast";
      toast.innerHTML = `
        <span>${label}</span>
        <button id="anime1-skip-btn" style="margin-left:10px;padding:3px 10px;border-radius:5px;border:none;background:#1677ff;color:#fff;cursor:pointer;font:inherit;font-size:13px;">跳過</button>
        <button id="anime1-skip-dismiss" style="margin-left:6px;padding:3px 8px;border-radius:5px;border:none;background:rgba(255,255,255,.15);color:#fff;cursor:pointer;font:inherit;font-size:13px;">✕</button>
      `;
      toast.style.cssText = `
        position:fixed;left:50%;bottom:80px;z-index:2147483647;
        transform:translateX(-50%);display:flex;align-items:center;
        border-radius:8px;padding:10px 14px;
        background:rgba(25,25,25,.92);color:#fff;
        font:14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        box-shadow:0 4px 18px rgba(0,0,0,.4);white-space:nowrap;
      `;
      document.body.appendChild(toast);
      skipToastEl = toast;

      toast.querySelector("#anime1-skip-btn").addEventListener("click", () => {
        video.currentTime = skipTo;
        toast.remove();
        window.clearTimeout(skipTimer);
      });
      toast.querySelector("#anime1-skip-dismiss").addEventListener("click", () => {
        toast.remove();
        window.clearTimeout(skipTimer);
      });

      if (autoSkipAfter > 0) {
        skipTimer = window.setTimeout(() => {
          if (!video.paused) { video.currentTime = skipTo; }
          toast.remove();
        }, autoSkipAfter * 1000);
      }
    }

    let introShown = false;
    let outroShown = false;

    function onTimeUpdate() {
      const t = video.currentTime;
      if (introBounds && !introShown && t >= 2 && t <= introBounds[1]) {
        introShown = true;
        showSkipToast("偵測到片頭曲", introBounds[1], 5);
      }
      if (outroBounds && !outroShown && t >= outroBounds[0] && t <= outroBounds[1]) {
        outroShown = true;
        showSkipToast("偵測到片尾曲", outroBounds[1], 5);
      }
    }

    video.addEventListener("play", () => {
      buildAnalyser();
      startSampling();
    });
    video.addEventListener("pause", stopSampling);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", () => {
      introShown = false;
      outroShown = false;
      introBounds = null;
      outroBounds = null;
      scanDone = false;
      scanForSegments();
    }, { once: true });

    if (video.readyState >= 1) scanForSegments();
  }

  function wireSkipAll() {
    document.querySelectorAll("video").forEach(wireSkipIntroOutro);
    new MutationObserver(() => document.querySelectorAll("video").forEach(wireSkipIntroOutro))
      .observe(document.documentElement, { childList: true, subtree: true });
  }

  function wireEndedJump(nextUrl) {
    let timer = 0;

    function cancelTimer() {
      window.clearTimeout(timer);
      timer = 0;
    }

    function onEnded() {
      if (!config.jumpWhenEnded || !nextUrl || timer) return;
      const delay = Math.max(0, Number(config.countdownSeconds) || 0) * 1000;
      timer = window.setTimeout(() => goToNext(nextUrl), delay);
    }

    function attach(video) {
      if (!video || video.dataset.anime1NextEndedAttached === "1") return;
      video.dataset.anime1NextEndedAttached = "1";
      video.addEventListener("ended", onEnded);
      video.addEventListener("play", cancelTimer);
      video.addEventListener("seeking", cancelTimer);
    }

    document.querySelectorAll("video").forEach(attach);
    new MutationObserver(() => document.querySelectorAll("video").forEach(attach))
      .observe(document.documentElement, { childList: true, subtree: true });
  }

  function injectStyles() {
    if (document.getElementById("anime1-next-settings-style")) return;
    const style = document.createElement("style");
    style.id = "anime1-next-settings-style";
    style.textContent = `
      #anime1-next-settings-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        place-items: center;
        background: rgba(0, 0, 0, .54);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #anime1-next-settings {
        width: min(420px, calc(100vw - 28px));
        border-radius: 8px;
        background: #fff;
        color: #1f2937;
        box-shadow: 0 18px 46px rgba(0, 0, 0, .34);
        overflow: hidden;
      }
      #anime1-next-settings header,
      #anime1-next-settings footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 14px 16px;
        background: #f6f7f9;
      }
      #anime1-next-settings header strong {
        font-size: 16px;
      }
      #anime1-next-settings form {
        display: grid;
        gap: 12px;
        padding: 16px;
      }
      #anime1-next-settings label {
        display: grid;
        gap: 6px;
        font-size: 14px;
      }
      #anime1-next-settings input[type="text"],
      #anime1-next-settings input[type="number"] {
        min-height: 36px;
        border: 1px solid #cdd3dc;
        border-radius: 6px;
        padding: 6px 8px;
        font: inherit;
      }
      #anime1-next-settings .anime1-next-check {
        grid-template-columns: 18px 1fr;
        align-items: center;
      }
      #anime1-next-settings .anime1-next-check input {
        width: 16px;
        height: 16px;
      }
      #anime1-next-settings button {
        min-height: 34px;
        border: 1px solid #cdd3dc;
        border-radius: 6px;
        padding: 6px 10px;
        background: #fff;
        color: #1f2937;
        cursor: pointer;
        font: inherit;
      }
      #anime1-next-settings button[data-primary="true"] {
        border-color: #1677ff;
        background: #1677ff;
        color: #fff;
      }
      #anime1-next-toast {
        position: fixed;
        left: 50%;
        top: 18px;
        z-index: 2147483647;
        transform: translateX(-50%);
        max-width: calc(100vw - 28px);
        border-radius: 8px;
        padding: 10px 12px;
        background: rgba(25, 25, 25, .9);
        color: #fff;
        font: 14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
    `;
    document.head.appendChild(style);
  }

  function notify(message) {
    injectStyles();
    const old = document.getElementById("anime1-next-toast");
    if (old) old.remove();
    const toast = document.createElement("div");
    toast.id = "anime1-next-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 1800);
  }

  function hotkeyInput(input) {
    input.addEventListener("keydown", (event) => {
      event.preventDefault();
      const value = eventToHotkey(event);
      if (value) input.value = value;
    });
  }

  function openSettings() {
    injectStyles();
    const old = document.getElementById("anime1-next-settings-backdrop");
    if (old) old.remove();

    const backdrop = document.createElement("div");
    backdrop.id = "anime1-next-settings-backdrop";

    const dialog = document.createElement("section");
    dialog.id = "anime1-next-settings";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const title = document.createElement("strong");
    title.textContent = SETTINGS_TITLE;

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "\u95dc\u9589";
    close.addEventListener("click", () => backdrop.remove());

    const header = document.createElement("header");
    header.append(title, close);

    const form = document.createElement("form");

    const nextInput = document.createElement("input");
    nextInput.type = "text";
    nextInput.value = config.nextHotkey;
    hotkeyInput(nextInput);

    const fullscreenInput = document.createElement("input");
    fullscreenInput.type = "text";
    fullscreenInput.value = config.fullscreenHotkey;
    hotkeyInput(fullscreenInput);

    const settingsInput = document.createElement("input");
    settingsInput.type = "text";
    settingsInput.value = config.settingsHotkey;
    hotkeyInput(settingsInput);

    const autoplay = document.createElement("input");
    autoplay.type = "checkbox";
    autoplay.checked = config.autoplayAfterJump;

    const ended = document.createElement("input");
    ended.type = "checkbox";
    ended.checked = config.jumpWhenEnded;

    const countdown = document.createElement("input");
    countdown.type = "number";
    countdown.min = "0";
    countdown.max = "60";
    countdown.step = "1";
    countdown.value = String(config.countdownSeconds);

    const skipIntroChk = document.createElement("input");
    skipIntroChk.type = "checkbox";
    skipIntroChk.checked = config.skipIntro;

    const skipOutroChk = document.createElement("input");
    skipOutroChk.type = "checkbox";
    skipOutroChk.checked = config.skipOutro;

    form.append(
      field("\u4e0b\u4e00\u96c6\u5feb\u6377\u9375", nextInput),
      field("\u5168\u87a2\u5e55\u5feb\u6377\u9375", fullscreenInput),
      field("\u958b\u555f\u8a2d\u5b9a\u5feb\u6377\u9375", settingsInput),
      check("\u8df3\u5230\u4e0b\u4e00\u96c6\u5f8c\u81ea\u52d5\u64ad\u653e", autoplay),
      check("\u5f71\u7247\u7d50\u675f\u5f8c\u81ea\u52d5\u8df3\u4e0b\u4e00\u96c6", ended),
      field("\u7d50\u675f\u5f8c\u8df3\u8f49\u5012\u6578\uff08\u79d2\uff09", countdown),
      check("\u5075\u6e2c\u7247\u982d\u66f2\u81ea\u52d5\u8df3\u904e", skipIntroChk),
      check("\u5075\u6e2c\u7247\u5c3e\u66f2\u81ea\u52d5\u8df3\u904e", skipOutroChk)
    );

    const save = document.createElement("button");
    save.type = "submit";
    save.dataset.primary = "true";
    save.textContent = "\u5132\u5b58";

    const footer = document.createElement("footer");
    footer.append(save);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      config = {
        nextHotkey: normalizeHotkey(nextInput.value) || defaults.nextHotkey,
        fullscreenHotkey: normalizeHotkey(fullscreenInput.value) || defaults.fullscreenHotkey,
        settingsHotkey: normalizeHotkey(settingsInput.value) || defaults.settingsHotkey,
        autoplayAfterJump: autoplay.checked,
        jumpWhenEnded: ended.checked,
        countdownSeconds: Math.max(0, Math.min(60, Number(countdown.value) || 0)),
        skipIntro: skipIntroChk.checked,
        skipOutro: skipOutroChk.checked,
        introWindow: defaults.introWindow,
        outroWindow: defaults.outroWindow
      };
      saveConfig(config);
      backdrop.remove();
      notify("\u5df2\u5132\u5b58 Anime1 \u5feb\u6377\u9375\u8a2d\u5b9a");
    });

    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) backdrop.remove();
    });

    dialog.append(header, form, footer);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    nextInput.focus();
  }

  function field(labelText, input) {
    const label = document.createElement("label");
    const span = document.createElement("span");
    span.textContent = labelText;
    label.append(span, input);
    return label;
  }

  function check(labelText, input) {
    const label = document.createElement("label");
    label.className = "anime1-next-check";
    const span = document.createElement("span");
    span.textContent = labelText;
    label.append(input, span);
    return label;
  }

  function wireHotkeys(nextUrl) {
    document.addEventListener("keydown", (event) => {
      if (isTypingTarget(document.activeElement)) return;
      const hotkey = eventToHotkey(event);

      if (hotkey === normalizeHotkey(config.settingsHotkey)) {
        event.preventDefault();
        openSettings();
        return;
      }

      if (hotkey === normalizeHotkey(config.nextHotkey)) {
        event.preventDefault();
        goToNext(nextUrl);
        return;
      }

      if (hotkey === normalizeHotkey(config.fullscreenHotkey)) {
        event.preventDefault();
        toggleFullscreen();
      }
    });
  }

  const nextUrl = findNextEpisodeUrl();

  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand(SETTINGS_TITLE, openSettings);
  }

  wireHotkeys(nextUrl);
  wireEndedJump(nextUrl);
  tryAutoplayIfRequested();
  wireSkipAll();
})();
