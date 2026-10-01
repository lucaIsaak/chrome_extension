// Service worker: owns session state, blocking rules and Gmail completion prompts,
// and (via shadow.js) records what websites collect about the user.
// Storage keys: blocklist [domain], session {startTime,endTime,minutes}, history [...], todos [...]

importScripts("shared.js", "trackers.js", "categories.js", "shadow.js");

const ALARM = "sessionEnd";
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
    removeRuleIds: existing.map((r) => r.id),
    addRules,
  });
}

async function endSession(status) {
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
}

// Finish the session if its time is up (e.g. after the browser was closed).
async function checkSession(tolerance = 0) {
  const { session } = await get("session");
  if (session && session.endTime - Date.now() <= tolerance) {
    await endSession("completed");
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
});
chrome.runtime.onStartup.addListener(() => serial(() => checkSession()));
chrome.runtime.onInstalled.addListener(() => serial(() => checkSession()));
