// YouTube Arka Planda Düşük Kalite - content.js (v5)
// - Düşürmeden HEMEN ÖNCE, her seferinde, "Kalite" menü satırının
//   metninden gerçek mevcut kaliteyi okur (getPlaybackQuality() API'si
//   güncel durumu güvenilir yansıtmadığı için artık kullanılmıyor).
// - Pencere odağı kaybı (blur) için kısa bir gecikme (debounce) var;
//   böylece DevTools konsoluna hızlıca bir şey yazmak yanlışlıkla
//   kaliteyi düşürtmüyor. Sekme gerçekten arka plana alınırsa
//   (visibilitychange) bu gecikme uygulanmaz, anında düşer.

(function () {
  const LOG = "[YT Arka Plan Kalite]";

  const LOW_QUALITY_REGEX = /^144p/i;
  const AUTO_REGEX = /^oto|^auto/i;
  const BLUR_DEBOUNCE_MS = 800;

  let enabled = true;
  let lowered = false;
  let busy = false;
  let previousQualityRegex = AUTO_REGEX;
  let blurTimer = null;

  function getPlayer() {
    return document.getElementById("movie_player");
  }

  function isWatchPage() {
    return location.pathname === "/watch";
  }

  function getMenuItems(player) {
    const menu = player.querySelector(".ytp-panel-menu");
    if (!menu) return { menu: null, items: [], texts: [] };
    const items = Array.from(menu.querySelectorAll(".ytp-menuitem"));
    const texts = items.map((i) => (i.textContent || "").trim());
    return { menu, items, texts };
  }

  function waitForMenuAppear(player, timeout = 800) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function poll() {
        const state = getMenuItems(player);
        if (state.items.length) return resolve(state);
        if (Date.now() - start > timeout) return resolve(null);
        requestAnimationFrame(poll);
      })();
    });
  }

  function waitForMenuChange(player, previousTexts, timeout = 1200) {
    return new Promise((resolve) => {
      const start = Date.now();
      const prevKey = previousTexts.join("|");
      (function poll() {
        const state = getMenuItems(player);
        const key = state.texts.join("|");
        if (state.items.length && key !== prevKey) return resolve(state);
        if (Date.now() - start > timeout) return resolve(null);
        requestAnimationFrame(poll);
      })();
    });
  }

  function looksLikeQualitySubmenu(items) {
    const texts = items.map((i) => (i.textContent || "").trim());
    const qualityLike = texts.filter(
      (t) => /^\d{3,4}p/i.test(t) || /^oto|^auto/i.test(t)
    );
    return qualityLike.length >= 2;
  }

  // Ana menüdeki "Kalite" satırının metnine bakarak (örn. "KaliteOtomatik (720p)"
  // veya "Kalite144p") gerçek mevcut kaliteyi çıkarır. Zaten alt menüdeysek,
  // işaretli (aria-checked) satırı arar.
  function captureCurrentQualityRegex(state, isSubmenu) {
    if (!isSubmenu) {
      const qualityItem = state.items.find((i) =>
        /kalite|quality|çözünürlük|resolution/i.test(i.textContent || "")
      );
      if (qualityItem) {
        const text = qualityItem.textContent || "";
        if (/oto|auto/i.test(text)) return AUTO_REGEX;
        const m = text.match(/(\d{3,4}p)/i);
        if (m) return new RegExp("^" + m[1], "i");
      }
      return AUTO_REGEX;
    }
    const checked = state.items.find((i) => i.getAttribute("aria-checked") === "true");
    if (checked) {
      const text = (checked.textContent || "").trim();
      if (/^oto|^auto/i.test(text)) return AUTO_REGEX;
      const m = text.match(/^(\d{3,4}p)/i);
      if (m) return new RegExp("^" + m[1], "i");
    }
    return AUTO_REGEX;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // targetRegex: geçilecek kalite. captureCurrent: true ise, geçiş yapmadan
  // önce mevcut kaliteyi de okuyup sonuçla birlikte döner.
  async function attemptQualityOperation(targetRegex, captureCurrent) {
    const player = getPlayer();
    if (!player) return { status: "no-player" };
    const settingsBtn = player.querySelector(".ytp-settings-button");
    if (!settingsBtn) return { status: "no-button" };

    settingsBtn.click();
    let state = await waitForMenuAppear(player);
    if (!state) return { status: "menu-not-opened" };

    const isSub = looksLikeQualitySubmenu(state.items);
    const capturedRegex = captureCurrent ? captureCurrentQualityRegex(state, isSub) : null;

    if (!isSub) {
      const qualityItem = state.items.find((i) =>
        /kalite|quality|çözünürlük|resolution/i.test(i.textContent || "")
      );
      if (!qualityItem) {
        settingsBtn.click();
        return { status: "no-quality-row" };
      }
      qualityItem.click();
      const subState = await waitForMenuChange(player, state.texts);
      if (!subState) return { status: "submenu-not-opened" };
      state = subState;
    }

    const target = state.items.find((o) => targetRegex.test((o.textContent || "").trim()));
    if (!target) {
      document.body.click();
      return { status: "target-not-found" };
    }

    target.click();
    return { status: "ok", label: target.textContent.trim(), capturedRegex };
  }

  async function operationWithRetry(targetRegex, captureCurrent, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
      const result = await attemptQualityOperation(targetRegex, captureCurrent);
      if (result.status === "ok") {
        console.log(LOG, "Kalite ayarlandı ->", result.label, `(${i + 1}. denemede)`);
        return result;
      }
      console.warn(LOG, `Deneme ${i + 1}/${attempts} başarısız:`, result.status);
      await sleep(200);
    }
    console.warn(LOG, "Tüm denemeler başarısız oldu.");
    return null;
  }

  async function lowerQuality() {
    if (!isWatchPage() || !enabled || busy || lowered) return;
    busy = true;
    try {
      const result = await operationWithRetry(LOW_QUALITY_REGEX, true);
      if (result) {
        previousQualityRegex = result.capturedRegex || AUTO_REGEX;
        lowered = true;
      }
    } finally {
      busy = false;
    }
  }

  async function restoreQuality() {
    if (!lowered || busy) return;
    busy = true;
    try {
      const result = await operationWithRetry(previousQualityRegex, false);
      if (result) lowered = false;
    } finally {
      busy = false;
    }
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      if (blurTimer) {
        clearTimeout(blurTimer);
        blurTimer = null;
      }
      lowerQuality();
    } else {
      restoreQuality();
    }
  }

  function handleWindowBlur() {
    if (blurTimer) clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      blurTimer = null;
      lowerQuality();
    }, BLUR_DEBOUNCE_MS);
  }

  function handleWindowFocus() {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    if (!document.hidden) restoreQuality();
  }

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("blur", handleWindowBlur);
  window.addEventListener("focus", handleWindowFocus);

  document.addEventListener("yt-navigate-finish", () => {
    lowered = false;
    previousQualityRegex = AUTO_REGEX;
  });

  if (chrome?.storage?.sync) {
    chrome.storage.sync.get(["enabled"], (res) => {
      if (typeof res.enabled === "boolean") enabled = res.enabled;
      console.log(LOG, "Eklenti durumu:", enabled ? "açık" : "kapalı");
    });
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.enabled) {
        enabled = changes.enabled.newValue;
        if (!enabled) restoreQuality();
      }
    });
  }

  console.log(LOG, "content.js yüklendi (v5 - anlık kalite okuma + blur debounce)");
})();
