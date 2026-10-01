const $ = (sel) => document.querySelector(sel);

const DEFAULTS = { blocklist: [], history: [], todos: [], session: null, scene: null };

const PRESETS = {
  dusk: { name: "Dusk", sky: ["#8fa1a0", "#c9c5b6"], seas: ["#2a5d70", "#1b4658", "#0f2f40"] },
  deep: { name: "Deep sea", sky: ["#0d2a45", "#2f6285"], seas: ["#1b4d6f", "#123a5a", "#0b2239"] },
  sunset: { name: "Sunset", sky: ["#4b3568", "#f29b7b"], seas: ["#5a3a66", "#3d2854", "#231637"] },
};
const DEFAULT_SCENE = { type: "preset", id: "dusk" };

const QUOTES = [
  "Take today one thing at a time.",
  "Small sessions, a steady reef.",
  "Let the coral grow.",
  "Depth beats speed.",
  "One tab, one task.",
  "Calm is a skill.",
];

let data = { ...DEFAULTS };
let minutes = 25;
let emailTag = false;
let banner = null; // "completed" | "failed" after a session ends while this tab is open
let sawActive = false;
let confirming = false;
let checking = false;
let coralKey = "";
let sceneKey = "";

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const send = (msg) => chrome.runtime.sendMessage(msg);
const isToday = (ts) => new Date(ts).toDateString() === new Date().toDateString();
const isActive = () => !!data.session && data.session.endTime > Date.now();

async function load() {
  data = { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}

async function refresh() {
  await load();
  if (isActive()) {
    sawActive = true;
  } else if (!data.session && sawActive) {
    sawActive = false;
    confirming = false;
    const last = data.history[data.history.length - 1];
    banner = last ? last.status : null;
  }
  render();
}

function setCoral(opts) {
  const key = JSON.stringify(opts);
  if (key === coralKey) return;
  coralKey = key;
  $("#coral").innerHTML = Reef.coralSVG(opts);
}

// ---------- Scene ----------
function presetGradient(p) {
  return `linear-gradient(${p.sky[0]}, ${p.sky[1]} 50%, ${p.seas[0]} 50%, ${p.seas[2]})`;
}

function applyScene() {
  const scene = data.scene || DEFAULT_SCENE;
  const key = scene.type + (scene.id || (scene.data || "").length);
  if (key === sceneKey) return;
  sceneKey = key;
  const el = $("#scene");
  if (scene.type === "image" && scene.data) {
    el.classList.add("custom");
    el.style.backgroundImage = `url("${scene.data}")`;
  } else {
    const p = PRESETS[scene.id] || PRESETS.dusk;
    el.classList.remove("custom");
    el.style.backgroundImage = "";
    el.style.setProperty("--sky-top", p.sky[0]);
    el.style.setProperty("--sky-glow", p.sky[1]);
    el.style.setProperty("--sea-1", p.seas[0]);
    el.style.setProperty("--sea-2", p.seas[1]);
    el.style.setProperty("--sea-3", p.seas[2]);
  }
  renderThumbs();
}

function renderThumbs() {
  const scene = data.scene || DEFAULT_SCENE;
  const wrap = $("#thumbs");
  wrap.replaceChildren();
  for (const [id, p] of Object.entries(PRESETS)) {
    const btn = document.createElement("button");
    btn.className = "thumb" + (scene.type === "preset" && scene.id === id ? " selected" : "");
    const swatch = document.createElement("i");
    swatch.style.background = presetGradient(p);
    btn.append(swatch, p.name);
    btn.addEventListener("click", () => chrome.storage.local.set({ scene: { type: "preset", id } }));
    wrap.append(btn);
  }
}

function showSceneError(text) {
  const err = $("#scene-error");
  err.textContent = text;
  err.hidden = false;
  setMenu(true);
}

async function useImage(file) {
  $("#scene-error").hidden = true;
  if (!file || !file.type.startsWith("image/")) return showSceneError("Choose an image file.");
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1920 / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    await chrome.storage.local.set({ scene: { type: "image", data: canvas.toDataURL("image/jpeg", 0.85) } });
  } catch {
    showSceneError("Couldn't read that image. Try another one.");
  }
}

function setMenu(open) {
  $("#scene-menu").hidden = !open;
  $("#scene-btn").setAttribute("aria-expanded", String(open));
}

$("#scene-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  setMenu($("#scene-menu").hidden);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".menu-wrap")) setMenu(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setMenu(false);
});
$("#upload-btn").addEventListener("click", () => $("#file").click());
$("#file").addEventListener("change", (e) => {
  useImage(e.target.files[0]);
  e.target.value = "";
});
$("#reset-btn").addEventListener("click", () => chrome.storage.local.remove("scene"));

document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer && e.dataTransfer.files[0];
  if (file) useImage(file);
});

// ---------- Hero ----------
function greeting() {
  if (isActive()) return "Stay with it.";
  if (banner === "completed") return "Well done.";
  if (banner === "failed") return "Try again when you're ready.";
  const h = new Date().getHours();
  return h < 5 ? "Good night." : h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.";
}

function updateHero() {
  const now = new Date();
  $("#clock").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  $("#date").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  $("#greeting").textContent = greeting();
  const day = Math.floor(now.getTime() / 864e5);
  $("#quote").textContent = QUOTES[day % QUOTES.length];
}

// ---------- Focus ----------
function renderFocus() {
  const active = isActive();
  const n = data.blocklist.length;
  $("#idle-panel").hidden = active;
  $("#active-panel").hidden = !active;
  $("#sites-block").hidden = active; // the list is locked while a session runs
  $("#confirm-box").hidden = !confirming;
  $("#give-up").hidden = confirming;
  $("#blocking-count").textContent = n ? `${n} site${n === 1 ? "" : "s"} blocked` : "";

  const b = $("#banner");
  b.hidden = active || !banner;
  b.className = "banner" + (banner === "failed" ? " failed" : "");
  b.textContent =
    banner === "completed"
      ? "Session complete. A new coral joined your reef."
      : "Your coral bleached.";

  if (active) {
    $("#blocking-info").textContent = `Blocking ${n} site${n === 1 ? "" : "s"}`;
    updateTimer();
  } else if (banner === "failed") {
    setCoral({ stage: 3, bleached: true });
  } else {
    setCoral({ stage: 4, hue: 12 });
  }
  $("#coral").classList.toggle("faded", !active && !banner);

  const today = data.history.filter((h) => isToday(h.endedAt));
  const done = today.filter((h) => h.status === "completed");
  const minutesToday = done.reduce((sum, h) => sum + h.minutes, 0);
  const todosToday = data.todos.filter((t) => t.done && isToday(t.doneAt)).length;
  $("#stats-line").textContent =
    `Today: ${done.length} completed · ${today.length - done.length} given up · ${minutesToday} focus min · ${todosToday} to-dos done`;
}

function updateTimer() {
  const s = data.session;
  if (!s) return;
  $("#timer").textContent = Reef.formatTime(s.endTime - Date.now());
  const progress = (Date.now() - s.startTime) / (s.endTime - s.startTime);
  setCoral({ stage: Reef.stageFor(progress), hue: 12 });
}

async function tick() {
  updateHero();
  if (!data.session || checking) return;
  if (data.session.endTime <= Date.now()) {
    checking = true;
    await send({ type: "check" });
    checking = false;
    await refresh();
  } else {
    updateTimer();
  }
}

$("#durations").addEventListener("click", (e) => {
  const min = e.target.dataset && e.target.dataset.min;
  if (!min) return;
  minutes = Number(min);
  for (const btn of document.querySelectorAll("#durations button")) {
    btn.classList.toggle("selected", btn.dataset.min === min);
  }
});
$("#start").addEventListener("click", async () => {
  banner = null;
  const res = await send({ type: "start", minutes });
  if (!res || !res.ok) alert(res && res.error ? res.error : "Could not start.");
  await refresh();
});
$("#give-up").addEventListener("click", () => { confirming = true; renderFocus(); });
$("#keep-going").addEventListener("click", () => { confirming = false; renderFocus(); });
$("#confirm-give-up").addEventListener("click", async () => {
  confirming = false;
  await send({ type: "giveUp" });
  await refresh();
});

// ---------- Blocked sites ----------
function renderSites() {
  const ul = $("#site-chips");
  ul.replaceChildren();
  if (!data.blocklist.length) {
    ul.append(el("li", "empty", "Nothing blocked yet. Add the sites that distract you."));
    return;
  }
  for (const domain of data.blocklist) {
    const li = el("li", "", domain);
    const del = el("button", "icon-btn", "×");
    del.title = "Remove";
    del.setAttribute("aria-label", "Remove " + domain);
    del.addEventListener("click", () => saveBlocklist(data.blocklist.filter((d) => d !== domain)));
    li.append(del);
    ul.append(li);
  }
}

async function saveBlocklist(blocklist) {
  if (isActive()) return;
  data.blocklist = blocklist;
  await chrome.storage.local.set({ blocklist });
  await send({ type: "syncRules" });
  render();
}

$("#site-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#site-error");
  const domain = Reef.normalizeDomain($("#site-input").value);
  if (!domain) {
    err.textContent = "Enter a valid site, like youtube.com.";
    err.hidden = false;
    return;
  }
  if (data.blocklist.includes(domain)) {
    err.textContent = domain + " is already in your list.";
    err.hidden = false;
    return;
  }
  err.hidden = true;
  $("#site-input").value = "";
  await saveBlocklist([...data.blocklist, domain]);
});

// ---------- To-do ----------
function renderTodos() {
  const open = data.todos.filter((t) => !t.done);
  const done = data.todos.filter((t) => t.done);
  $("#todo-empty").hidden = open.length > 0;
  $("#open-count").textContent = `${open.length} open`;
  $("#done-count").textContent = done.length;

  const fill = (ul, items) => {
    ul.replaceChildren();
    for (const t of items) {
      const li = document.createElement("li");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = t.done;
      check.setAttribute("aria-label", t.done ? "Mark as not done" : "Mark as done");
      check.addEventListener("change", () => toggleTodo(t.id));
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = t.title;
      li.append(check, label);
      if (t.tag === "email") {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = "Send email";
        li.append(badge);
      }
      const del = document.createElement("button");
      del.className = "icon-btn";
      del.textContent = "×";
      del.title = "Delete";
      del.setAttribute("aria-label", "Delete to-do");
      del.addEventListener("click", () => deleteTodo(t.id));
      li.append(del);
      ul.append(li);
    }
  };
  fill($("#todo-open"), open);
  fill($("#todo-done"), done);
}

async function saveTodos(todos) {
  data.todos = todos;
  await chrome.storage.local.set({ todos });
  render();
}
const toggleTodo = (id) =>
  saveTodos(data.todos.map((t) => (t.id === id ? { ...t, done: !t.done, doneAt: t.done ? null : Date.now() } : t)));
const deleteTodo = (id) => saveTodos(data.todos.filter((t) => t.id !== id));

$("#tag-toggle").addEventListener("click", () => setEmailTag(!emailTag));
function setEmailTag(on) {
  emailTag = on;
  $("#tag-toggle").classList.toggle("on", on);
  $("#tag-toggle").setAttribute("aria-pressed", String(on));
}

$("#todo-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("#todo-title").value.trim();
  const err = $("#todo-error");
  if (!title) {
    err.textContent = "Enter a title first.";
    err.hidden = false;
    return;
  }
  err.hidden = true;
  const todo = { id: crypto.randomUUID(), title, tag: emailTag ? "email" : "none", done: false, doneAt: null, createdAt: Date.now() };
  $("#todo-title").value = "";
  setEmailTag(false);
  await saveTodos([...data.todos, todo]);
});

// ---------- Reef ----------
function renderReef() {
  const corals = data.history.filter((h) => h.status === "completed");
  $("#reef").innerHTML = corals.slice(-24).map((h) => Reef.coralSVG({ stage: 4, hue: h.hue })).join("");
  $("#reef-count").textContent = corals.length
    ? `${corals.length} coral${corals.length === 1 ? "" : "s"} in your reef`
    : "Finish a session to grow your first coral";
}

function render() {
  applyScene();
  updateHero();
  renderFocus();
  renderSites();
  renderTodos();
  renderReef();
}

chrome.storage.onChanged.addListener((changes) => {
  if (Object.keys(changes).some((k) => k in DEFAULTS)) refresh(); // ignore Shadow tracking writes
});

(async () => {
  await send({ type: "check" }); // finalize a session that ended while the browser was closed
  await refresh();
  setInterval(tick, 1000);
})();
