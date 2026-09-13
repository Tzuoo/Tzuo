// ==UserScript==
// @name         嗶哩輕小說
// @namespace    codex.local.linovelib
// @version      1.1.1
// @updateURL    https://raw.githubusercontent.com/Tzuoo/Tzuo/main/%E6%B2%B9%E7%8C%B4%E8%85%B3%E6%9C%AC/%E5%97%B6%E5%93%A9%E8%BC%95%E5%B0%8F%E8%AA%AA.user.js
// @downloadURL  https://raw.githubusercontent.com/Tzuoo/Tzuo/main/%E6%B2%B9%E7%8C%B4%E8%85%B3%E6%9C%AC/%E5%97%B6%E5%93%A9%E8%BC%95%E5%B0%8F%E8%AA%AA.user.js
// @description  將嗶哩輕小說變成適合大尺寸電視的中央窄欄，支援拖曳控制列及記憶設定。
// @match        https://tw.linovelib.com/novel/*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(() => {
  "use strict";

  GM_addStyle(`
    :root {
      --tv-reader-width: 520px;
    }

    #abox,
    #abox .atitle {
      box-sizing: border-box !important;
      width: calc(100% - 32px) !important;
      max-width: var(--tv-reader-width) !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    #tv-reader-controls {
      position: fixed;
      z-index: 2147483647;
      right: 18px;
      top: 18px;
      display: flex;
      gap: 6px;
      padding: 8px;
      border: 1px solid rgba(127, 127, 127, 0.45);
      border-radius: 12px;
      background: rgba(35, 35, 35, 0.88);
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.25);
      font-family: system-ui, sans-serif;
      user-select: none;
      touch-action: none;
    }

    #tv-reader-drag-handle {
      display: grid;
      place-items: center;
      width: 30px;
      border-radius: 8px;
      color: #ddd;
      background: #444;
      cursor: grab;
      font-size: 20px;
      line-height: 1;
    }

    #tv-reader-drag-handle:active {
      cursor: grabbing;
    }

    #tv-reader-controls button {
      min-width: 54px;
      padding: 8px 10px;
      border: 0;
      border-radius: 8px;
      color: #eee;
      background: #555;
      cursor: pointer;
      font-size: 14px;
    }

    #tv-reader-controls button[data-active="true"] {
      color: #222;
      background: #f1d48a;
    }

    @media (max-width: 700px) {
      #tv-reader-controls {
        transform: scale(0.88);
        transform-origin: top right;
      }
    }
  `);

  const allowedWidths = [460, 520, 580];
  const widthKey = "tvReaderColumnWidth";
  const positionKey = "tvReaderControlsPosition";
  const savedWidth = Number(localStorage.getItem(widthKey));
  let currentWidth = allowedWidths.includes(savedWidth) ? savedWidth : 520;

  const controls = document.createElement("div");
  controls.id = "tv-reader-controls";
  controls.setAttribute("aria-label", "閱讀欄寬");

  const dragHandle = document.createElement("div");
  dragHandle.id = "tv-reader-drag-handle";
  dragHandle.textContent = "⠿";
  dragHandle.title = "按住並拖曳控制列";
  controls.appendChild(dragHandle);

  const applyWidth = (width) => {
    currentWidth = width;
    document.documentElement.style.setProperty("--tv-reader-width", `${width}px`);
    localStorage.setItem(widthKey, String(width));

    controls.querySelectorAll("button").forEach((button) => {
      button.dataset.active = String(Number(button.dataset.width) === width);
    });
  };

  for (const width of allowedWidths) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.width = String(width);
    button.textContent = width === 460 ? "較窄" : width === 520 ? "舒適" : "較寬";
    button.title = `閱讀欄寬 ${width}px`;
    button.addEventListener("click", () => applyWidth(width));
    controls.appendChild(button);
  }

  document.body.appendChild(controls);
  applyWidth(currentWidth);

  const keepOnScreen = (left, top) => ({
    left: Math.max(8, Math.min(left, window.innerWidth - controls.offsetWidth - 8)),
    top: Math.max(8, Math.min(top, window.innerHeight - controls.offsetHeight - 8))
  });

  const setPosition = (left, top, save = true) => {
    const position = keepOnScreen(left, top);
    controls.style.left = `${position.left}px`;
    controls.style.top = `${position.top}px`;
    controls.style.right = "auto";
    if (save) localStorage.setItem(positionKey, JSON.stringify(position));
  };

  try {
    const savedPosition = JSON.parse(localStorage.getItem(positionKey));
    if (Number.isFinite(savedPosition?.left) && Number.isFinite(savedPosition?.top)) {
      setPosition(savedPosition.left, savedPosition.top, false);
    }
  } catch {}

  dragHandle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    dragHandle.setPointerCapture(event.pointerId);
    const rect = controls.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;

    const move = (moveEvent) => {
      setPosition(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY, false);
    };

    const finish = () => {
      const finalRect = controls.getBoundingClientRect();
      setPosition(finalRect.left, finalRect.top, true);
      dragHandle.removeEventListener("pointermove", move);
      dragHandle.removeEventListener("pointerup", finish);
      dragHandle.removeEventListener("pointercancel", finish);
    };

    dragHandle.addEventListener("pointermove", move);
    dragHandle.addEventListener("pointerup", finish);
    dragHandle.addEventListener("pointercancel", finish);
  });

  window.addEventListener("resize", () => {
    const rect = controls.getBoundingClientRect();
    setPosition(rect.left, rect.top, false);
  });
})();
