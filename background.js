// Service worker: owns session state, blocking rules and Gmail completion prompts,
// and (via shadow.js) records what websites collect about the user.
// Storage keys: blocklist [domain], session {startTime,endTime,minutes}, history [...], todos [...]

importScripts("shared.js", "trackers.js", "categories.js", "report.js", "protect.js", "shadow.js");

const ALARM = "sessionEnd";
const PRUNE_ALARM = "shadowPrune";
const CLEAN_ALARM = "protectClean";
// Rule ids: focus mode below 10000, tracker blocking 10000..19999, protections (protect.js) from 20000.
// Each part rewrites only its own range.
const TRACKER_RULE_BASE = 10000;
const PROTECT_RULE_BASE = Protect.RULE_BASE;
const END_TOLERANCE_MS = 5000;

// All session changes run one after another so alarm/popup calls can't race.
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

const get = (keys) => chrome.storage.local.get(keys);

async function syncRules() {
  const { session, blocklist = [] } = await get(["session", "blocklist"]);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const active = session && session.endTime > Date.now();
  const addRules = active
    ? blocklist.map((domain, i) => ({
        id: i + 1,
        priority: 1,
        action: {
          type: "redirect",
          redirect: { extensionPath: "/blocked.html?site=" + encodeURIComponent(domain) },
        },
        condition: { urlFilter: "||" + domain + "^", resourceTypes: ["main_frame"] },
      }))
    : [];
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.filter((r) => r.id < TRACKER_RULE_BASE).map((r) => r.id),
    addRules,
  });
}

// Block the tracking domains the user chose, but only when loaded by another site (never the site itself)
async function syncTrackerRules() {
  const { blockedTrackers = {} } = await get("blockedTrackers");
  const protect = await getProtect();
  const domains = Trackers.blockDomains(blockedTrackers).slice(0, 4000);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const types = ["sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "media", "websocket", "other"];
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.filter((r) => r.id >= TRACKER_RULE_BASE && r.id < PROTECT_RULE_BASE).map((r) => r.id),
    addRules: domains.map((d, i) => ({
      id: TRACKER_RULE_BASE + i,
      priority: 1,
      action: { type: "block" },
      // a site the user paused protection on keeps its trackers
      condition: { urlFilter: "||" + d + "^", domainType: "thirdParty", resourceTypes: types, ...(protect.paused.length ? { excludedInitiatorDomains: protect.paused } : {}) },
    })),
  });
}

const getProtect = async () => Protect.normalize((await get("protect")).protect);

// Link-cleaning, privacy headers and HTTPS upgrade, from the protection settings
async function syncProtectRules() {
  const protect = await getProtect();
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.filter((r) => r.id >= PROTECT_RULE_BASE).map((r) => r.id),
    addRules: Protect.rules(protect, PROTECT_RULE_BASE),
  });
  await syncCleanAlarm(protect);
}

async function syncCleanAlarm(protect) {
  const mins = Protect.CLEAN_MINUTES[protect.autoClean];
  if (!mins) return chrome.alarms.clear(CLEAN_ALARM);
  const existing = await chrome.alarms.get(CLEAN_ALARM);
  if (!existing || existing.periodInMinutes !== mins) await chrome.alarms.create(CLEAN_ALARM, { delayInMinutes: mins, periodInMinutes: mins });
}

// Change protection settings. A level applies its preset. "Block all" lives with the blocked trackers so the
// recorder and the blocked list see it too.
async function setProtect(patch) {
  const { protect: before, blockedTrackers = {} } = await get(["protect", "blockedTrackers"]);
  const protect = Protect.normalize(before, patch || {});
  await chrome.storage.local.set({ protect, blockedTrackers: { companies: blockedTrackers.companies || [], domains: blockedTrackers.domains || [], all: protect.blockAll } });
  await syncProtectRules();
  await syncTrackerRules();
  return { ok: true, protect };
}

async function togglePaused(site, paused) {
  const dom = Reef.normalizeDomain(site);
  if (!dom) return { ok: false };
  const { paused: list } = await getProtect();
  return setProtect({ paused: paused ? [...list, dom] : list.filter((d) => d !== dom) });
}

async function togglePrivate(site, on) {
  const dom = Reef.normalizeDomain(site);
  if (!dom) return { ok: false };
  const { privateSites } = await getProtect();
  return setProtect({ privateSites: on ? [...privateSites, dom] : privateSites.filter((d) => d !== dom) });
}

// ---------- Clean up cookies ----------
const registrableOf = (d) => Reef.registrable(String(d).replace(/^\./, ""));

async function removeCookiesFor(domain) {
  let n = 0;
  let cookies = [];
  try {
    cookies = await chrome.cookies.getAll({ domain });
  } catch {
    return 0;
  }
  for (const c of cookies) {
    const url = (c.secure ? "https://" : "http://") + c.domain.replace(/^\./, "") + c.path;
    try {
      if (await chrome.cookies.remove({ url, name: c.name, storeId: c.storeId, ...(c.partitionKey ? { partitionKey: c.partitionKey } : {}) })) n++;
    } catch {}
  }
  return n;
}

// Tracking domains whose cookies are safe to clear: known trackers and ones the user chose to block, never a site
// the user signs in to or has visited themselves.
async function trackerDomainsToClean(site) {
  const { sites = {}, blockedTrackers = {} } = await get(["sites", "blockedTrackers"]);
  const visited = new Set(Object.keys(sites).map(registrableOf));
  const out = new Set();
  const consider = (d) => {
    const reg = registrableOf(d);
    if (!reg || Protect.matches(reg, Protect.KEEP) || visited.has(reg)) return;
    out.add(reg);
  };
  if (site) {
    for (const [dom, t] of Object.entries((sites[site] && sites[site].trackers) || {})) {
      if ((t.company && Trackers.TRACKING.has(t.cat)) || (blockedTrackers.domains || []).includes(dom)) consider(dom);
    }
  } else {
    Trackers.trackingDomains().forEach(consider);
    (blockedTrackers.domains || []).forEach(consider);
    for (const s of Object.values(sites)) {
      for (const [dom, t] of Object.entries(s.trackers || {})) if (t.company && Trackers.TRACKING.has(t.cat)) consider(dom);
    }
  }
  return [...out];
}

async function cleanTrackers({ site, firstParty = false, auto = false } = {}) {
  const dom = site ? Reef.normalizeDomain(site) : null;
  const domains = await trackerDomainsToClean(dom);
  let removed = 0;
  for (let i = 0; i < domains.length; i += 15) {
    removed += (await Promise.all(domains.slice(i, i + 15).map(removeCookiesFor))).reduce((a, b) => a + b, 0);
  }
  if (dom && firstParty) {
    removed += await removeCookiesFor(registrableOf(dom));
    // cookies and the rest of what the site keeps on this device (not history or saved passwords)
    const origins = ["https://", "http://"].flatMap((p) => [p + dom, p + "www." + dom]);
    try {
      await chrome.browsingData.remove({ origins }, { localStorage: true, indexedDB: true, cacheStorage: true, serviceWorkers: true });
    } catch {}
  }
  const { protectStats = {} } = await get("protectStats");
  const day = Report.dayKey(new Date());
  const days = { ...(protectStats.days || {}), [day]: ((protectStats.days || {})[day] || 0) + removed };
  const keep = Object.keys(days).sort().slice(-30);
  await chrome.storage.local.set({
    protectStats: { total: (protectStats.total || 0) + removed, last: Date.now(), lastCount: removed, lastAuto: !!auto, days: Object.fromEntries(keep.map((k) => [k, days[k]])) },
  });
  return { ok: true, removed, domains: domains.length };
}

// Run a missed automatic clean (for example when the browser was closed at the time)
async function cleanIfDue() {
  const protect = await getProtect();
  const mins = Protect.CLEAN_MINUTES[protect.autoClean];
  if (!mins) return;
  const { protectStats = {} } = await get("protectStats");
  if (Date.now() - (protectStats.last || 0) >= mins * 60000) await cleanTrackers({ auto: true });
}

// ---------- Private windows ----------
// Reopen listed sites in a private window. If that is not possible the tab simply stays as it is.
const handledNav = new Map();
async function openPrivate(url) {
  try {
    await chrome.windows.create({ url, incognito: true, focused: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "Private windows are not available. Allow Reef in private windows on chrome://extensions, then try again." };
  }
}

if (chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
    if (!info.url || (tab && tab.incognito)) return;
    let host;
    try {
      const u = new URL(info.url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return;
      host = u.hostname;
    } catch {
      return;
    }
    const p = await getProtect();
    if (!(Protect.matches(host, p.privateSites) || (p.privateSensitive && Cats.isSensitive(host)))) return;
    const key = tabId + "|" + info.url;
    if (Date.now() - (handledNav.get(key) || 0) < 5000) return;
    handledNav.set(key, Date.now());
    if (handledNav.size > 50) handledNav.delete(handledNav.keys().next().value);
    const res = await openPrivate(info.url);
    if (res.ok) chrome.tabs.remove(tabId).catch(() => {});
  });
}

async function changeBlocked(msg) {
  const { blockedTrackers = {} } = await get("blockedTrackers");
  let companies = blockedTrackers.companies || [];
  let domains = blockedTrackers.domains || [];
  let all = !!blockedTrackers.all;
  if (msg.type === "unblockAll") {
    companies = [];
    domains = [];
    if (all) {
      all = false;
      const { protect } = await get("protect");
      await chrome.storage.local.set({ protect: Protect.normalize(protect, { blockAll: false }) });
      await syncProtectRules();
    }
  } else if (msg.type === "blockMany") {
    companies = [...new Set([...companies, ...(Array.isArray(msg.companies) ? msg.companies.map(String) : [])])];
    domains = [...new Set([...domains, ...(Array.isArray(msg.domains) ? msg.domains.map(Reef.normalizeDomain).filter(Boolean) : [])])];
  } else if (msg.company) {
    const name = String(msg.company);
    companies = msg.type === "blockTracker" ? [...new Set([...companies, name])] : companies.filter((c) => c !== name);
  } else if (msg.domain) {
    const dom = Reef.normalizeDomain(msg.domain);
    if (!dom) return { ok: false };
    domains = msg.type === "blockTracker" ? [...new Set([...domains, dom])] : domains.filter((d) => d !== dom);
  }
  await chrome.storage.local.set({ blockedTrackers: { companies, domains, all } });
  await syncTrackerRules();
  return { ok: true };
}

// Count how often the focus blocker turned a visit away, per day and site
async function noteBlockedVisit(site) {
  const dom = Reef.normalizeDomain(site);
  if (!dom) return;
  const { focusStats = {} } = await get("focusStats");
  const day = Report.dayKey(new Date());
  focusStats[day] = focusStats[day] || {};
  focusStats[day][dom] = (focusStats[day][dom] || 0) + 1;
  const keep = Object.keys(focusStats).sort().slice(-60);
  await chrome.storage.local.set({ focusStats: Object.fromEntries(keep.map((k) => [k, focusStats[k]])) });
}

// Tell the user a focus session finished (only when the timer ended while they were doing something else)
async function notifyDone(minutes) {
  try {
    await chrome.notifications.create("sessionDone", {
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: "Focus session complete",
      message: minutes + " minutes done. A new coral joined your reef.",
    });
  } catch {}
}
if (chrome.notifications && chrome.notifications.onClicked) {
  chrome.notifications.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html") }));
}

async function endSession(status, notify = false) {
  const { session, history = [] } = await get(["session", "history"]);
  if (!session) return;
  history.push({
    id: crypto.randomUUID(),
    status, // "completed" | "failed"
    minutes: session.minutes,
    endedAt: Date.now(),
    hue: Math.floor(Math.random() * 360),
  });
  await chrome.storage.local.set({ history });
  await chrome.storage.local.remove("session");
  await chrome.alarms.clear(ALARM);
  await syncRules();
  if (status === "completed" && notify) await notifyDone(session.minutes);
}

// Finish the session if its time is up (e.g. after the browser was closed).
async function checkSession(tolerance = 0) {
  const { session } = await get("session");
  if (session && session.endTime - Date.now() <= tolerance) {
    await endSession("completed", tolerance > 0); // alarm path: notify
  } else {
    await syncRules();
  }
}

async function startSession(minutes) {
  const { session } = await get("session");
  if (session && session.endTime > Date.now()) return { ok: false, error: "A session is already running." };
  if (!Number.isFinite(minutes) || minutes <= 0) return { ok: false, error: "Invalid duration." };
  const startTime = Date.now();
  const endTime = startTime + minutes * 60000;
  await chrome.storage.local.set({ session: { startTime, endTime, minutes } });
  await chrome.alarms.create(ALARM, { when: endTime });
  await syncRules();
  return { ok: true };
}

async function openEmailTodos() {
  const { todos = [] } = await get("todos");
  return todos.filter((t) => !t.done && t.tag === "email");
}

async function completeTodos(ids) {
  const { todos = [] } = await get("todos");
  const now = Date.now();
  for (const t of todos) {
    if (ids.includes(t.id) && !t.done && t.tag === "email") {
      t.done = true;
      t.doneAt = now;
    }
  }
  await chrome.storage.local.set({ todos });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "shadowStatus") {
    Shadow.status().then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }
  if (msg && msg.type === "deleteSite") {
    Shadow.deleteSite(String(msg.site || "")).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }
  if (msg && (msg.type === "fp" || msg.type === "page")) {
    Shadow.handle(msg, sender).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  const handle = async () => {
    switch (msg && msg.type) {
      case "start":
        return startSession(Number(msg.minutes));
      case "giveUp":
        await endSession("failed");
        return { ok: true };
      case "check":
        await checkSession();
        return { ok: true };
      case "syncRules":
        await syncRules();
        return { ok: true };
      case "blockTracker":
      case "unblockTracker":
      case "unblockAll":
      case "blockMany":
        return changeBlocked(msg);
      case "setProtect":
        return setProtect(msg.patch);
      case "pauseSite":
        return togglePaused(msg.site, !!msg.paused);
      case "privateSite":
        return togglePrivate(msg.site, !!msg.on);
      case "cleanTrackers":
        return cleanTrackers({ site: msg.site, firstParty: !!msg.firstParty });
      case "openPrivate":
        return /^https?:\/\//.test(String(msg.url || "")) ? openPrivate(String(msg.url)) : { ok: false };
      case "blockedHit":
        await noteBlockedVisit(msg.site);
        return { ok: true };
      case "emailSent": {
        // Only the fact that an email was sent is known here, never its content.
        const todos = await openEmailTodos();
        return { todos: todos.map((t) => ({ id: t.id, title: t.title })) };
      }
      case "completeTodos":
        await completeTodos(Array.isArray(msg.ids) ? msg.ids : []);
        return { ok: true };
      default:
        return { ok: false };
    }
  };
  serial(handle).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async response
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) serial(() => checkSession(END_TOLERANCE_MS));
  if (alarm.name === PRUNE_ALARM) Shadow.prune();
  if (alarm.name === CLEAN_ALARM) cleanTrackers({ auto: true }).catch(() => {});
});

const schedulePrune = () => chrome.alarms.create(PRUNE_ALARM, { delayInMinutes: 5, periodInMinutes: 1440 });

chrome.runtime.onStartup.addListener(() => {
  schedulePrune();
  serial(async () => {
    await checkSession();
    await syncTrackerRules();
    await syncProtectRules();
    await cleanIfDue().catch(() => {});
  });
});

chrome.runtime.onInstalled.addListener(() => {
  schedulePrune();
  serial(async () => {
    await checkSession();
    await syncTrackerRules();
    await syncProtectRules();
    // Recording stays off until the user has read the welcome page and agreed
    const { settings = {} } = await get("settings");
    if (!settings.welcomed) await chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  });
});
