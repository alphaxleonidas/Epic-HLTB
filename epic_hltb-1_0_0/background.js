// Opens a hidden tab on howlongtobeat.com, runs a search, waits until the
// actual search-results page (not a leftover/cached previous page) has
// rendered a result matching the requested game, then closes the tab.
// Triggered by a "searchHLTB" message from content.js.

const HLTB_BASE = "https://howlongtobeat.com";

function searchUrl(name) {
  // Defensive guard: if `name` somehow already arrived percent-encoded,
  // decode it first so we only ever encode once. Encoding an already-encoded
  // string turns "%3A" into "%253A", which HLTB then treats as literal
  // garbage text in the query and returns zero results for.
  let clean = name;
  try {
    const decoded = decodeURIComponent(clean);
    if (decoded !== clean) clean = decoded;
  } catch (_) {
    // Not a valid percent-encoded sequence - use the name as-is.
  }
  return `${HLTB_BASE}/?q=${encodeURIComponent(clean)}`;
}

async function openHiddenTab(url) {
  return chrome.tabs.create({ url, active: false });
}

async function closeTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch (_) {
    // tab may already be closed
  }
}

function waitForTabLoad(tabId, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs);
  });
}

// Runs inside the HLTB tab. Returns null if the real search-results page
// hasn't rendered yet (or hasn't rendered a result matching the query yet),
// or a { found, game } object once it has. HLTB is itself a Next.js SPA, so
// the page can transiently still contain markup/data from whatever it last
// rendered (e.g. a previously cached game page) before the client-side
// router swaps in the actual search results - checking specifically for the
// "#search-results-header" results container, and requiring the top match to
// actually relate to the requested name, avoids ever locking onto that
// leftover content.
function attemptScrape(queryName) {
  const container = document.getElementById("search-results-header");
  if (!container) return null; // not on a rendered search-results page yet

  const items = Array.from(container.querySelectorAll("ul > li"));
  if (items.length === 0) return null; // header rendered but list not populated yet

  function normalize(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function scoreMatch(candidateName, query) {
    const c = normalize(candidateName);
    const q = normalize(query);
    if (!c || !q) return 0;
    if (c === q) return 100;
    if (c.startsWith(q) || q.startsWith(c)) return 80;
    if (c.includes(q) || q.includes(c)) return 60;
    const cTokens = new Set(c.split(" "));
    const qTokens = q.split(" ").filter(Boolean);
    if (qTokens.length === 0) return 0;
    const overlap = qTokens.filter((t) => cTokens.has(t)).length;
    return (overlap / qTokens.length) * 50;
  }

  function formatHours(value) {
    if (!value || value === "--") return null;
    const cleaned = value.replace("½", ".5").replace(/\s*Hours?\s*$/i, "").trim();
    return cleaned ? `${cleaned}h` : null;
  }

  const candidates = [];
  for (const li of items) {
    const link = li.querySelector('h2 a[href*="/game/"]');
    if (!link) continue;
    const hrefMatch = (link.getAttribute("href") || "").match(/\/game\/(\d+)/);
    if (!hrefMatch) continue;

    const id = hrefMatch[1];
    const name = (link.getAttribute("title") || link.textContent || "").trim();
    if (!name) continue;

    const tidbits = Array.from(li.querySelectorAll('[class*="search_list_tidbit"]')).map((el) =>
      el.textContent.trim()
    );

    // Tidbits render as alternating [label, value, label, value, ...]
    const stats = {};
    for (let i = 0; i + 1 < tidbits.length; i += 2) {
      stats[tidbits[i]] = tidbits[i + 1];
    }

    candidates.push({
      id,
      name,
      score: scoreMatch(name, queryName),
      mainStory: formatHours(stats["Main Story"] || stats["Solo"]),
      mainExtra: formatHours(stats["Main + Extra"] || stats["Co-Op"]),
      completionist: formatHours(stats["Completionist"] || stats["Vs."])
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // No candidate bears any resemblance to what we searched for - the results
  // list is up but doesn't reflect our query yet (or genuinely has no match).
  // Keep waiting rather than accept an unrelated game's data.
  if (best.score <= 0) return null;

  return {
    found: true,
    game: {
      id: best.id,
      name: best.name,
      mainStory: best.mainStory,
      mainExtra: best.mainExtra,
      completionist: best.completionist
    }
  };
}

async function waitForMatchingResult(tabId, queryName, maxAttempts = 30, delayMs = 500) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: attemptScrape,
      args: [queryName]
    });
    const value = result?.[0]?.result;
    if (value) return value;
  }
  return { found: false };
}

async function searchHLTB(name) {
  const url = searchUrl(name);
  const tab = await openHiddenTab(url);
  try {
    await waitForTabLoad(tab.id);
    const result = await waitForMatchingResult(tab.id, name);
    await closeTab(tab.id);
    return result;
  } catch (err) {
    await closeTab(tab.id);
    throw err;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "searchHLTB") {
    searchHLTB(message.gameName)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // keep the message channel open for the async response
  }
});
