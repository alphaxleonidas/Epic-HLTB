// Epic's base HTML ships a generic site-wide title/meta ("Epic Games Store")
// before the SPA loads the specific game's data. Treat that placeholder (and
// close variants) as "not found yet" rather than a valid game name, or a
// fast-firing check can grab it before the real title ever renders.
const GENERIC_TITLES = new Set(["epic games store", "epic games", "store", ""]);

function isGenericTitle(t) {
  return GENERIC_TITLES.has(t.trim().toLowerCase());
}

function slugToTitle(slug) {
  let s = slug;
  // Strip a trailing Epic-style id segment, e.g. "-e55d50" (short hex string).
  // Only strips it if it actually looks like a generated id, since some
  // titles legitimately end in numbers/words that shouldn't be stripped.
  s = s.replace(/-[0-9a-f]{4,8}$/i, "");
  s = s.replace(/-/g, " ");
  s = s.replace(/\b\w/g, (c) => c.toUpperCase());
  return s.trim();
}

function getGameNameFromUrl() {
  const match = location.pathname.match(/\/p\/([^/]+)/);
  if (!match) return null;
  const slug = decodeURIComponent(match[1]);
  const title = slugToTitle(slug);
  return title && !isGenericTitle(title) ? title : null;
}

function getGameNameOnce() {
  // 1. The actual rendered product title - most reliable, since it's exactly
  //    what the page shows the user (correct punctuation, symbols, etc.)
  const titleSpan = document.querySelector('span[data-testid="pdp-title"]');
  if (titleSpan && titleSpan.textContent && titleSpan.textContent.trim()) {
    const t = titleSpan.textContent.trim();
    if (!isGenericTitle(t)) return t;
  }

  // 2. og:title meta tag - server-rendered, available before hydration
  const og = document.querySelector('meta[property="og:title"]');
  if (og) {
    const content = og.getAttribute("content");
    if (content) {
      let t = content.split("|")[0].trim();
      t = t.replace(/\s*-\s*Epic Games Store\s*$/i, "").trim();
      if (t && !isGenericTitle(t)) return t;
    }
  }

  // 3. document.title
  const n = document.title;
  if (n) {
    let t = n.split("|")[0].trim();
    t = t.replace(/\s*-\s*Epic Games Store\s*$/i, "").trim();
    if (t && !isGenericTitle(t)) return t;
  }

  // 4. last resort: derive a title from the URL slug
  const fromUrl = getGameNameFromUrl();
  if (fromUrl) return fromUrl;

  return null;
}

// Epic's store is a single-page app: navigating between games updates the URL
// via the History API without a real page load, so the title/meta tags for
// the new game aren't necessarily in the DOM the instant the URL changes.
// Poll briefly for them instead of checking exactly once.
function waitForGameName(timeoutMs = 8000, intervalMs = 250) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const name = getGameNameOnce();
      if (name) {
        resolve(name);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(null);
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

const CONTAINER_ID = "hltb-container";
const HLTB_BASE = "https://howlongtobeat.com";

const STYLES = {
  container: `
    background: linear-gradient(135deg, #0f0f10 0%, #202024 100%);
    border-bottom: 2px solid #ffffff;
    padding: 12px 20px;
    font-family: Arial, sans-serif;
    color: #e6e6e6;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 20px;
    position: relative;
    z-index: 1000;
  `,
  link: `
    color: #ffffff;
    text-decoration: none;
    font-weight: bold;
    font-size: 14px;
  `,
  separator: `
    color: #4a4a4a;
    margin: 0 8px;
  `,
  error: `
    font-size: 14px;
    color: #ff6b6b;
  `,
  text: `
    font-size: 14px;
  `,
  highlight: `
    color: #ffffff;
  `
};

function isProductPage(pathname) {
  return pathname.includes("/p/");
}

function removeContainer() {
  const existing = document.getElementById(CONTAINER_ID);
  if (existing) existing.remove();
}

function createContainer() {
  const el = document.createElement("div");
  el.id = CONTAINER_ID;
  el.style.cssText = STYLES.container;
  const parent = document.body;
  parent.insertBefore(el, parent.firstChild);
  return el;
}

function showSearching(el, name) {
  el.textContent = "";
  const span = document.createElement("span");
  span.style.cssText = STYLES.text;
  const strong = document.createElement("strong");
  strong.style.cssText = STYLES.highlight;
  strong.textContent = "HowLongToBeat:";
  span.appendChild(strong);
  span.appendChild(document.createTextNode(` Searching for "${name}"...`));
  el.appendChild(span);
}

function showError(el, message) {
  el.textContent = "";
  const span = document.createElement("span");
  span.style.cssText = STYLES.error;
  const strong = document.createElement("strong");
  strong.textContent = "HowLongToBeat:";
  span.appendChild(strong);
  span.appendChild(document.createTextNode(` Error: ${message}`));
  el.appendChild(span);
}

function showNoData(el, name) {
  el.textContent = "";
  const span = document.createElement("span");
  span.style.cssText = STYLES.text;
  const strong = document.createElement("strong");
  strong.style.cssText = STYLES.highlight;
  strong.textContent = "HowLongToBeat:";
  span.appendChild(strong);
  span.appendChild(document.createTextNode(` No data found for "${name}"`));
  el.appendChild(span);
}

function makeStat(label, value) {
  const span = document.createElement("span");
  const strong = document.createElement("strong");
  strong.textContent = `${label}:`;
  span.appendChild(strong);
  span.appendChild(document.createTextNode(` ${value}`));
  return span;
}

function makeSeparator() {
  const span = document.createElement("span");
  span.style.cssText = STYLES.separator;
  span.textContent = "|";
  return span;
}

function showResult(el, game) {
  const stats = [];
  if (game.mainStory) stats.push({ label: "Main Story", value: game.mainStory });
  if (game.mainExtra) stats.push({ label: "Main + Extra", value: game.mainExtra });
  if (game.completionist) stats.push({ label: "Completionist", value: game.completionist });

  el.textContent = "";

  if (stats.length === 0) {
    const span = document.createElement("span");
    span.style.cssText = STYLES.text;
    const strong = document.createElement("strong");
    strong.style.cssText = STYLES.highlight;
    strong.textContent = "HowLongToBeat:";
    span.appendChild(strong);
    span.appendChild(document.createTextNode(` No time data available for "${game.name}"`));
    el.appendChild(span);
    return;
  }

  const link = document.createElement("a");
  link.href = `${HLTB_BASE}/game/${game.id}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.style.cssText = STYLES.link;
  link.textContent = "HowLongToBeat";
  el.appendChild(link);

  stats.forEach((s) => {
    el.appendChild(makeSeparator());
    el.appendChild(makeStat(s.label, s.value));
  });
}

let currentRunId = 0;

async function runForCurrentPage() {
  const runId = ++currentRunId;
  removeContainer();

  if (!isProductPage(location.pathname)) return;

  const name = await waitForGameName();

  // Bail if the user navigated again while we were waiting, or if a newer
  // run has already started (avoids painting a stale/wrong game's result).
  if (runId !== currentRunId) return;
  if (!name || !isProductPage(location.pathname)) return;

  const container = createContainer();
  showSearching(container, name);

  try {
    const response = await chrome.runtime.sendMessage({ type: "searchHLTB", gameName: name });
    if (runId !== currentRunId) return; // a newer page/run has taken over
    if (response.error) {
      showError(container, response.error);
    } else if (response.found) {
      showResult(container, response.game);
    } else {
      showNoData(container, name);
    }
  } catch (err) {
    if (runId === currentRunId) showError(container, err.message);
  }
}

function watchForNavigation() {
  // Compare pathname only, not the full URL — Epic's SPA fires
  // pushState/replaceState for things that aren't real navigation (query
  // string tweaks, tracking params, etc.), and reacting to those would
  // cancel an in-flight search before it finishes.
  let lastPath = location.pathname;

  const onPossibleNavigation = () => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      runForCurrentPage();
    }
  };

  ["pushState", "replaceState"].forEach((method) => {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      onPossibleNavigation();
      return result;
    };
  });

  window.addEventListener("popstate", onPossibleNavigation);

  // Polling fallback in case some navigation happens in a way we didn't catch above.
  setInterval(onPossibleNavigation, 1000);
}

runForCurrentPage();
watchForNavigation();
