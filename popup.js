const $ = (sel) => document.querySelector(sel);

const DEFAULTS = { blocklist: [], history: [], todos: [], session: null };
let data = { ...DEFAULTS };
let banner = null; // "completed" | "failed" after a session ends while the popup is open
let sawActive = false;
let confirming = false;
let checking = false;
let coralKey = "";

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

// ---------- Focus ----------
function renderFocus() {
  const active = isActive();
  $("#idle-panel").hidden = active;
  $("#active-panel").hidden = !active;
  $("#empty-hint").hidden = data.blocklist.length > 0;
  $("#confirm-box").hidden = !confirming;
  $("#give-up").hidden = confirming;

  const b = $("#banner");
  b.hidden = active || !banner;
  b.className = "banner" + (banner === "failed" ? " failed" : "");
  b.textContent =
    banner === "completed"
      ? "Session complete! A new coral joined your reef."
      : "Your coral bleached. Try again when you're ready.";

  if (active) {
    const n = data.blocklist.length;
    $("#blocking-info").textContent = `Blocking ${n} site${n === 1 ? "" : "s"}`;
    updateTimer();
  } else if (banner === "completed") {
    setCoral({ stage: 4, hue: 12 });
  } else if (banner === "failed") {
    setCoral({ stage: 3, bleached: true });
  } else {
    setCoral({ stage: 0, hue: 12 });
  }

  const today = data.history.filter((h) => isToday(h.endedAt));
  const done = today.filter((h) => h.status === "completed");
  $("#stat-completed").textContent = done.length;
  $("#stat-failed").textContent = today.length - done.length;
  $("#stat-minutes").textContent = done.reduce((sum, h) => sum + h.minutes, 0);
  $("#stat-todos").textContent = data.todos.filter((t) => t.done && isToday(t.doneAt)).length;
}

function updateTimer() {
  const s = data.session;
  if (!s) return;
  const remaining = s.endTime - Date.now();
  $("#timer").textContent = Reef.formatTime(remaining);
  const progress = (Date.now() - s.startTime) / (s.endTime - s.startTime);
  setCoral({ stage: Reef.stageFor(progress), hue: 12 });
}

async function tick() {
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

$("#start").addEventListener("click", async () => {
  banner = null;
  const res = await send({ type: "start", minutes: Number($("#duration").value) });
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

// ---------- To-do ----------
function renderTodos() {
  const open = data.todos.filter((t) => !t.done);
  const done = data.todos.filter((t) => t.done);
  $("#todo-empty").hidden = open.length > 0;

  const fill = (ul, items) => {
    ul.replaceChildren();
    for (const t of items) {
      const li = document.createElement("li");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = t.done;
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

$("#todo-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("#todo-title").value.trim();
  const err = $("#todo-error");
  if (!title) {
    err.textContent = "Please enter a title.";
    err.hidden = false;
    return;
  }
  err.hidden = true;
  const todo = { id: crypto.randomUUID(), title, tag: $("#todo-tag").value, done: false, doneAt: null, createdAt: Date.now() };
  $("#todo-title").value = "";
  await saveTodos([...data.todos, todo]);
});

// ---------- Sites ----------
function renderSites() {
  const active = isActive();
  const ul = $("#site-list");
  ul.replaceChildren();
  for (const domain of data.blocklist) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = domain;
    const del = document.createElement("button");
    del.className = "icon-btn";
    del.textContent = "×";
    del.title = active ? "Locked during a focus session" : "Remove";
    del.disabled = active;
    del.addEventListener("click", () => removeSite(domain));
    li.append(label, del);
    ul.append(li);
  }
  $("#site-empty").hidden = data.blocklist.length > 0;
  $("#site-lock").hidden = !active;
}

async function saveBlocklist(blocklist) {
  data.blocklist = blocklist;
  await chrome.storage.local.set({ blocklist });
  await send({ type: "syncRules" });
  render();
}
const removeSite = (domain) => {
  if (isActive()) return;
  return saveBlocklist(data.blocklist.filter((d) => d !== domain));
};

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
    err.textContent = `${domain} is already in your list.`;
    err.hidden = false;
    return;
  }
  err.hidden = true;
  $("#site-input").value = "";
  await saveBlocklist([...data.blocklist, domain]);
});

// ---------- Reef ----------
function renderReef() {
  const corals = data.history.filter((h) => h.status === "completed");
  $("#reef-count").textContent = corals.length
    ? `${corals.length} coral${corals.length === 1 ? "" : "s"} in your reef`
    : "Your reef is empty. Finish a focus session to grow your first coral.";
  $("#reef-grid").innerHTML = corals.map((h) => Reef.coralSVG({ stage: 4, hue: h.hue })).join("");
}

// ---------- Tabs & wiring ----------
$("#tabs").addEventListener("click", (e) => {
  const tab = e.target.dataset && e.target.dataset.tab;
  if (!tab) return;
  for (const btn of document.querySelectorAll("#tabs button")) btn.classList.toggle("active", btn.dataset.tab === tab);
  for (const name of ["focus", "todo", "sites", "reef"]) $("#tab-" + name).hidden = name !== tab;
});

function render() {
  renderFocus();
  renderTodos();
  renderSites();
  renderReef();
}

chrome.storage.onChanged.addListener(refresh);

(async () => {
  await send({ type: "check" }); // finalize a session that ended while the browser was closed
  await refresh();
  setInterval(tick, 1000);
})();
