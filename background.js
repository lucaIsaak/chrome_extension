// Service worker: owns session state, blocking rules and Gmail completion prompts,
// and (via shadow.js) records what websites collect about the user.
// Storage keys: blocklist [domain], session {startTime,endTime,minutes}, history [...], todos [...]

importScripts("shared.js", "trackers.js", "categories.js", "report.js", "shadow.js");

const ALARM = "sessionEnd";
const PRUNE_ALARM = "shadowPrune";
// Focus-mode rules use ids below this number, tracker-blocking rules use ids from it upwards,
// so each part can rewrite its own rules without deleting the other's.
const TRACKER_RULE_BASE = 10000;
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
  const domains = Trackers.blockDomains(blockedTrackers).slice(0, 4000);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const types = ["sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "media", "websocket", "other"];
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.filter((r) => r.id >= TRACKER_RULE_BASE).map((r) => r.id),
    addRules: domains.map((d, i) => ({
      id: TRACKER_RULE_BASE + i,
      priority: 1,
      action: { type: "block" },
      condition: { urlFilter: "||" + d + "^", domainType: "thirdParty", resourceTypes: types },
    })),
  });
}

async function changeBlocked(msg) {
  const { blockedTrackers = {} } = await get("blockedTrackers");
  let companies = blockedTrackers.companies || [];
  let domains = blockedTrackers.domains || [];
  if (msg.type === "unblockAll") {
    companies = [];
    domains = [];
  } else if (msg.company) {
    const name = String(msg.company);
    companies = msg.type === "blockTracker" ? [...new Set([...companies, name])] : companies.filter((c) => c !== name);
  } else if (msg.domain) {
    const dom = Reef.normalizeDomain(msg.domain);
    if (!dom) return { ok: false };
    domains = msg.type === "blockTracker" ? [...new Set([...domains, dom])] : domains.filter((d) => d !== dom);
  }
  await chrome.storage.local.set({ blockedTrackers: { companies, domains } });
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
        return changeBlocked(msg);
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
});

const schedulePrune = () => chrome.alarms.create(PRUNE_ALARM, { delayInMinutes: 5, periodInMinutes: 1440 });

chrome.runtime.onStartup.addListener(() => {
  schedulePrune();
  serial(async () => {
    await checkSession();
    await syncTrackerRules();
  });
});

chrome.runtime.onInstalled.addListener(() => {
  schedulePrune();
  serial(async () => {
    await checkSession();
    await syncTrackerRules();
    // Recording stays off until the user has read the welcome page and agreed
    const { settings = {} } = await get("settings");
    if (!settings.welcomed) await chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  });
});
