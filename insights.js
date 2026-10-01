const $ = (sel) => document.querySelector(sel);

let data = { sites: {}, signals: null, settings: { tracking: false } };
const THEMES = ["glass", "hud", "terminal"];
let theme = "glass";
let view = "decoded"; // "raw" or "decoded" (plain-words explanations)
const openSites = new Set();
let confirmingClear = false;
let renderTimer = null;

// What each fingerprinting-related signal means, and how much it counts for the exposure score
const FP_INFO = {
  canvas: { text: "Read back canvas pixels (a graphics fingerprint)", weight: 8 },
  webgl: { text: "Asked for your graphics card model", weight: 8 },
  audio: { text: "Rendered audio to fingerprint your audio stack", weight: 8 },
  fonts: { text: "Probed which fonts are installed", weight: 6 },
  geolocation: { text: "Requested your location", weight: 8 },
  hardware: { text: "Read CPU cores and memory", weight: 3 },
  plugins: { text: "Listed your browser plugins", weight: 3 },
  beacon: { text: "Sent a background beacon (survives closing the page)", weight: 3 },
  screen: { text: "Read your screen size and colour depth", weight: 1 },
  language: { text: "Read your language list", weight: 1 },
  timezone: { text: "Read your time zone", weight: 1 },
};
const CAT_LABEL = {
  advertising: "advertising", analytics: "analytics", social: "social", "session-replay": "session replay",
  "data-broker": "data broker", "tag-manager": "tag manager", cdn: "infrastructure", other: "third party",
};

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

async function load() {
  const stored = await chrome.storage.local.get(["sites", "signals", "settings", "shadowTheme", "footprintView", "blockedTrackers", "signalDays", "focusStats", "blocklist", "twinFeedback", "networkSettings", "reefHealth", "protect", "protectStats"]);
  applyTheme(stored.shadowTheme);
  view = stored.footprintView === "raw" ? "raw" : "decoded";
  const feedback = {};
  for (const [k, v] of Object.entries(stored.twinFeedback || {})) if (Date.now() - v.at < 30 * 86400000) feedback[k] = v; // answers fade after 30 days
  data = {
    sites: stored.sites || {},
    signals: stored.signals || null,
    settings: { tracking: false, ...(stored.settings || {}) },
    blocked: stored.blockedTrackers || { companies: [], domains: [] },
    days: stored.signalDays || {},
    focusStats: stored.focusStats || {},
    blocklist: stored.blocklist || [],
    feedback,
    protect: Protect.normalize(stored.protect),
    protectStats: stored.protectStats || {},
    score: stored.reefHealth == null ? null : stored.reefHealth,
    network: { global: false, friends: false, habits: [], shareBlocked: true, shareHabits: true, ...(stored.networkSettings || {}) },
  };
}

// ---------- Theme ----------
function applyTheme(name) {
  theme = THEMES.includes(name) ? name : "glass";
  document.body.dataset.theme = theme;
  for (const b of document.querySelectorAll(".themes button")) b.setAttribute("aria-pressed", String(b.dataset.theme === theme));
  if (stage) stage.setTheme(theme);
}

// ---------- Scoring ----------
function scoreSite(site) {
  const reasons = [];
  let score = 0;
  const trackers = Object.values(site.trackers || {}).filter((t) => Trackers.TRACKING.has(t.cat));
  const trackerScore = Math.min(50, trackers.length * 5);
  score += trackerScore;
  if (trackers.length) reasons.push(`${trackers.length} tracking domain${trackers.length === 1 ? "" : "s"}`);

  const thirdCookies = Object.values(site.cookies || {}).filter((c) => c.third).length;
  score += Math.min(15, thirdCookies * 3);
  if (thirdCookies) reasons.push(`${thirdCookies} third-party cookie${thirdCookies === 1 ? "" : "s"}`);

  let fp = 0;
  const fpKinds = new Set();
  for (const [key, n] of Object.entries(site.fp || {})) {
    const [type, host] = key.split("|");
    if (host === "(site itself)") continue;
    fp += (FP_INFO[type] ? FP_INFO[type].weight : 1) * Math.min(n, 3);
    fpKinds.add(type);
  }
  score += Math.min(25, fp);
  if (fpKinds.size) reasons.push(`${fpKinds.size} device-reading technique${fpKinds.size === 1 ? "" : "s"} by third parties`);

  const ids = Object.values(site.params || {}).filter((p) => p.kind === "identifier").length;
  score += Math.min(10, ids * 2);
  if (ids) reasons.push(`${ids} identifier${ids === 1 ? "" : "s"} sent out`);

  score = Math.min(100, score);
  const level = score < 20 ? ["Low", "low", "Barely tracked"] : score < 45 ? ["Medium", "medium", "Somewhat tracked"] : score < 70 ? ["High", "high", "Heavily tracked"] : ["Very high", "vhigh", "Extremely tracked"];
  return { score, label: level[0], cls: level[1], plain: level[2], reasons, trackers: trackers.length };
}

// ---------- Footprint ----------
function browserEnv() {
  const nav = navigator;
  return {
    platform: (nav.userAgentData && nav.userAgentData.platform) || nav.platform || "",
    ua: nav.userAgent || "",
    langs: [...(nav.languages || [nav.language])],
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    cores: nav.hardwareConcurrency,
    memory: nav.deviceMemory,
    screen: { w: screen.width, h: screen.height },
    depth: screen.colorDepth,
    touch: nav.maxTouchPoints,
  };
}

function renderEnv() {
  const e = browserEnv();
  const rows = [
    ["System", e.platform || "unknown"],
    ["Browser", (e.ua.match(/(Chrome|Edg|Firefox|Safari)\/[\d.]+/) || ["unknown"])[0]],
    ["Languages", e.langs.join(", ")],
    ["Time zone", e.tz],
    ["Screen", `${e.screen.w}×${e.screen.h}, ${e.depth}-bit colour`],
    ["CPU cores", e.cores],
    ["Memory", e.memory ? `${e.memory}+ GB` : "hidden"],
    ["Touch", e.touch ? `${e.touch} points` : "none"],
    ["IP address", "Every request reveals it, and with it an approximate city"],
    ["Referrer", "The page you came from, sent when you follow a link"],
  ];
  const dl = $("#env");
  dl.replaceChildren();
  for (const [k, v] of rows) dl.append(el("dt", "", k), el("dd", "", String(v)));
}

function renderSummary(entries) {
  const trackerDomains = new Set();
  const companies = {};
  let fpEvents = 0;
  for (const [site, s] of entries) {
    for (const [dom, t] of Object.entries(s.trackers || {})) {
      if (!Trackers.TRACKING.has(t.cat)) continue;
      trackerDomains.add(dom);
      if (t.company) (companies[t.company] = companies[t.company] || { sites: new Set(), cats: new Set() }).sites.add(site);
      if (t.company) companies[t.company].cats.add(t.cat);
    }
    for (const [key, n] of Object.entries(s.fp || {})) if (!key.endsWith("|(site itself)")) fpEvents += n;
  }
  const plain = view === "decoded";
  const tiles = [
    [entries.length, plain ? "websites you visited" : "websites recorded"],
    [trackerDomains.size, plain ? "tracking services found" : "tracking domains"],
    [Object.keys(companies).length, plain ? "companies watching you" : "companies following you"],
    [fpEvents, plain ? "times your device was inspected" : "device-reading calls by third parties"],
  ];
  const wrap = $("#summary");
  wrap.replaceChildren();
  for (const [n, label] of tiles) {
    const t = el("div", "tile");
    t.append(el("b", "", n.toLocaleString()), el("span", "", label));
    wrap.append(t);
  }

  const list = $("#companies");
  list.replaceChildren();
  const top = Object.entries(companies).sort((a, b) => b[1].sites.size - a[1].sites.size).slice(0, 8);
  $("#companies-empty").hidden = top.length > 0;
  for (const [name, c] of top) {
    const li = el("li");
    const row = el("div", "row");
    row.append(el("span", "", name), el("small", "", `${c.sites.size} of ${entries.length} site${entries.length === 1 ? "" : "s"} · ${[...c.cats].map((x) => CAT_LABEL[x]).join(", ")}`));
    const track = el("div", "track");
    const bar = el("i");
    bar.style.width = Math.max(4, (c.sites.size / entries.length) * 100) + "%";
    track.append(bar);
    li.append(row, track, blockButton({ company: name }));
    list.append(li);
  }
}

function section(title, items, emptyText) {
  const wrap = el("div");
  wrap.append(el("h3", "", title));
  if (!items.length) {
    wrap.append(el("div", "empty", emptyText));
    return wrap;
  }
  const ul = el("ul");
  for (const li of items) ul.append(li);
  wrap.append(ul);
  return wrap;
}

function buildDetail(site, s, scored) {
  const box = el("div", "detail");
  box.append(el("p", "reason", scored.reasons.length ? "Why: " + scored.reasons.join(", ") + "." : "Nothing tracking-related observed."));

  const trackers = Object.entries(s.trackers || {}).sort((a, b) => b[1].n - a[1].n);
  box.append(
    section(
      `Third parties contacted (${trackers.length})`,
      trackers.slice(0, 25).map(([dom, t]) => {
        const li = el("li");
        const types = Object.entries(t.types || {}).map(([k, v]) => `${k} ×${v}`).join(", ");
        li.append(el("span", "grow mono", dom + (t.company ? ` · ${t.company}` : "")), el("span", "chip " + t.cat, CAT_LABEL[t.cat] || t.cat), el("span", "reason", `${t.n} request${t.n === 1 ? "" : "s"} (${types})`));
        if (t.company && Trackers.TRACKING.has(t.cat)) li.append(blockButton({ company: t.company }));
        else if (!t.company && t.cat === "other") li.append(blockButton({ domain: dom }));
        return li;
      }),
      "No third parties seen."
    )
  );

  const cookies = Object.values(s.cookies || {}).sort((a, b) => Number(b.third) - Number(a.third));
  box.append(
    section(
      `Cookies set (${cookies.length})`,
      cookies.slice(0, 25).map((c) => {
        const li = el("li");
        li.append(el("span", "grow mono", `${c.name} @ ${c.d}`), el("span", "chip", c.third ? "third party" : "first party"), el("span", "reason", c.days ? `lasts ${c.days} day${c.days === 1 ? "" : "s"}` : "session only"));
        return li;
      }),
      "No cookies observed."
    )
  );

  const params = Object.values(s.params || {}).sort((a, b) => b.n - a.n);
  box.append(
    section(
      `Data sent to third parties (${params.length})`,
      params.slice(0, 25).map((p) => {
        const li = el("li");
        li.append(el("span", "chip", p.kind), el("span", "grow mono", `${p.k} = ${p.sample}`), el("span", "reason", `to ${p.d}`));
        return li;
      }),
      "No identifiers or device data seen in requests."
    )
  );

  const fps = Object.entries(s.fp || {}).sort((a, b) => b[1] - a[1]);
  box.append(
    section(
      `Device reading and fingerprinting (${fps.length})`,
      fps.slice(0, 25).map(([key, n]) => {
        const [type, host] = key.split("|");
        const li = el("li");
        li.append(el("span", "grow", (FP_INFO[type] ? FP_INFO[type].text : type)), el("span", "chip" + (host === "(site itself)" ? "" : " advertising"), host), el("span", "reason", `${n}×`));
        return li;
      }),
      "No device-reading calls seen."
    )
  );
  return box;
}

function renderSites(entries) {
  const wrap = $("#sites");
  wrap.replaceChildren();
  $("#sites-empty").hidden = entries.length > 0;
  $("#site-count").textContent = entries.length ? "sorted by exposure" : "";
  const scored = entries.map(([site, s]) => ({ site, s, sc: scoreSite(s) })).sort((a, b) => b.sc.score - a.sc.score || b.s.visits - a.s.visits);
  for (const { site, s, sc } of scored) {
    const d = el("details", "site");
    const sum = el("summary");
    const plain = view === "decoded";
    const toggle = el("span", "view-toggle");
    for (const [key, label] of [["raw", "Raw data"], ["decoded", "Decoded"]]) {
      const b = el("button", "", label);
      b.type = "button";
      b.title = key === "raw" ? "Technical details" : "Explained in plain words";
      b.setAttribute("aria-pressed", String(view === key));
      b.addEventListener("click", (e) => {
        e.preventDefault(); // do not open or close the row
        e.stopPropagation();
        setView(key);
      });
      toggle.append(b);
    }
    const meta = plain
      ? `${countWatchers(s)} compan${countWatchers(s) === 1 ? "y" : "ies"} watching · visited ${s.visits}×`
      : `${sc.trackers} tracker${sc.trackers === 1 ? "" : "s"} · ${s.visits} visit${s.visits === 1 ? "" : "s"}`;
    sum.append(el("span", "domain", site), toggle, el("span", "meta", meta), el("span", "pill " + sc.cls, plain ? sc.plain : sc.label));
    d.append(sum);
    const fill = () => {
      const body = view === "decoded" ? buildDecoded(site, s, sc) : buildDetail(site, s, sc);
      body.append(siteProtect(site, s), siteActions(site, s));
      d.append(body);
    };
    d.addEventListener("toggle", () => {
      if (d.open) {
        openSites.add(site);
        if (d.children.length === 1) fill();
      } else {
        openSites.delete(site);
      }
    });
    if (openSites.has(site)) {
      fill();
      d.open = true;
    }
    wrap.append(d);
  }
}

// ---------- Blocking trackers ----------
const isCompanyBlocked = (name) => (data.blocked.companies || []).includes(name);
const isDomainBlocked = (dom) => (data.blocked.domains || []).includes(dom);

function blockButton({ company, domain }) {
  const blocked = company ? isCompanyBlocked(company) : isDomainBlocked(domain);
  const b = el("button", "block-btn" + (blocked ? " on" : ""), blocked ? "Blocked · undo" : company ? "Block " + company : "Block this domain");
  b.type = "button";
  b.title = blocked
    ? "Click to allow it again"
    : company
      ? `Stops all of ${company}'s tracking domains on every site you visit. A few sites may break. You can undo this any time.`
      : `Stops ${domain} on every site you visit. You can undo this any time.`;
  b.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: blocked ? "unblockTracker" : "blockTracker", company, domain });
    await load();
    render();
  });
  return b;
}

function renderBlocked() {
  const box = $("#blocked");
  box.replaceChildren();
  const companies = data.blocked.companies || [];
  const domains = data.blocked.domains || [];
  const total = companies.length + domains.length;
  const head = el("div", "head");
  head.append(el("h2", "", "Blocked trackers"), el("span", "hint", total ? `${total} blocked` : ""));
  box.append(head);
  if (data.blocked.all) box.append(el("p", "hint", "Block-all is on (Strict level): every known ad, analytics, session-replay and data-broker tracker is blocked, plus any listed here."));
  if (!total && data.blocked.all) return;
  if (!total) {
    box.append(el("p", "hint", "Nothing blocked yet. Open a website below and press Block next to a company to stop it on every site."));
    return;
  }
  const week = Report.weekly(data.days);
  const ul = el("ul", "clean-list");
  const row = (name, detail, undo) => {
    const li = el("li");
    const text = el("span", "grow");
    text.append(el("b", "", name), el("span", "reason", " " + detail));
    li.append(text, undo);
    ul.append(li);
  };
  for (const c of companies) row(c, `${Trackers.domainsFor(c).length} domains · stopped ${week.blockedBy[c] || 0} requests this week`, blockButton({ company: c }));
  for (const d of domains) row(d, "single domain", blockButton({ domain: d }));
  box.append(ul);
  const all = el("button", "block-btn", "Unblock everything");
  all.type = "button";
  all.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "unblockAll" });
    await load();
    render();
  });
  box.append(all, el("p", "hint", "Blocking a company stops all its tracking domains, which can include embedded videos or login buttons. If a site misbehaves, undo it here."));
}

// ---------- Weekly report and reef health ----------
function renderWeekly() {
  const w = Report.weekly(data.days);
  const box = $("#weekly");
  box.replaceChildren();
  box.append(el("div", "eyebrow", "This week"));
  if (!w.hasData) {
    box.append(el("p", "hint", "Browse for a few days with recording on and your weekly report appears here."));
    return;
  }
  const top = el("div", "weekly-top");
  const big = el("div", "weekly-big");
  big.append(el("b", "", String(w.companies)), el("span", "", ` ${w.companies === 1 ? "company" : "companies"} watched you`));
  let delta = "First week of data";
  let tone = "flat";
  if (w.hasPrev) {
    if (w.delta > 0) { delta = `▲ ${w.delta} more than last week`; tone = "up"; }
    else if (w.delta < 0) { delta = `▼ ${-w.delta} fewer than last week`; tone = "down"; }
    else delta = "Same as last week";
  }
  top.append(big, el("span", "delta " + tone, delta));
  box.append(top);

  const grid = el("div", "weekly-grid");
  const stat = (label, value) => {
    const d = el("div");
    d.append(el("small", "", label), el("b", "", value));
    grid.append(d);
  };
  stat("Worst site", w.worstSite ? `${w.worstSite.site} (${w.worstSite.companies} companies)` : "none yet");
  stat("Top watcher", w.topWatcher ? `${w.topWatcher.name}, on ${w.topWatcher.sites} site${w.topWatcher.sites === 1 ? "" : "s"}` : "none yet");
  stat("Stopped by Reef", `${w.blocked} request${w.blocked === 1 ? "" : "s"}`);
  box.append(grid);

  const h = Report.health(w, Protect.points(data.protect));
  const health = el("div", "health");
  const msg = h >= 75 ? "Clear water: few trackers reach you." : h >= 45 ? "A bit cloudy: block more trackers to clear it." : "Murky water: many trackers follow you.";
  health.append(el("span", "hint", `Reef health ${h}/100 · ${msg}`));
  const track = el("div", "track");
  const bar = el("i");
  bar.style.width = h + "%";
  track.append(bar);
  health.append(track);
  box.append(health);
}

// ---------- Distracting sites and their trackers ----------
function renderDistracting() {
  const box = $("#distracting");
  box.replaceChildren();
  box.append(el("h2", "", "Your distracting sites"));
  const list = data.blocklist || [];
  if (!list.length) {
    box.append(el("p", "hint", "You have not blocked any sites for focus yet. Add some in the Focus card on your new tab, and Reef will show how much tracking they carry."));
    return;
  }
  const hits = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    for (const [dom, n] of Object.entries((data.focusStats || {})[Report.dayKey(d)] || {})) hits[dom] = (hits[dom] || 0) + n;
  }
  let totalHits = 0;
  let avoided = 0;
  const ul = el("ul", "clean-list");
  for (const dom of list) {
    const site = data.sites[Reef.registrable(dom)];
    const watchers = site ? countWatchers(site) : null;
    const h = hits[dom] || 0;
    totalHits += h;
    if (watchers) avoided += h * watchers;
    const li = el("li");
    const text = el("span", "grow");
    text.append(el("b", "", dom), el("span", "reason", " " + (watchers === null ? "no data yet. Visit it once with recording on." : `${watchers} tracking compan${watchers === 1 ? "y" : "ies"} usually watch you here`)));
    li.append(text, el("span", "reason", `${h} visit${h === 1 ? "" : "s"} turned away`));
    ul.append(li);
  }
  box.append(
    el("p", "hint", totalHits
      ? `This week Reef turned away ${totalHits} visit${totalHits === 1 ? "" : "s"} to these sites${avoided ? `, which avoided roughly ${avoided} tracking-company encounters` : ""}. Staying focused is also a privacy win.`
      : "No visits turned away yet this week. When a focus session blocks one of these, it counts here."),
    ul
  );
}

// ---------- "Is this you?" feedback on the twin ----------
function feedbackRow(a) {
  const fb = (data.feedback || {})[a.key];
  const row = el("div", "feedback");
  row.append(el("span", "hint", "Is this you?"));
  for (const [verdict, label] of [["right", "✓ Right"], ["wrong", "✕ Wrong"]]) {
    const on = fb && fb.verdict === verdict;
    const b = el("button", on ? "on " + verdict : "", label);
    b.type = "button";
    b.addEventListener("click", () => rate(a.key, on ? null : verdict));
    row.append(b);
  }
  return row;
}

async function rate(key, verdict) {
  const fb = { ...(data.feedback || {}) };
  if (verdict) fb[key] = { verdict, at: Date.now() };
  else delete fb[key];
  data.feedback = fb;
  await chrome.storage.local.set({ twinFeedback: fb });
  renderTwin();
}

// ---------- Export and delete ----------
function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const today = () => new Date().toISOString().slice(0, 10);

function siteActions(site, s) {
  const row = el("div", "site-actions");
  const exp = el("button", "", "Export this site");
  exp.type = "button";
  exp.addEventListener("click", () => download(`reef-${site}-${today()}.json`, { site, exportedAt: new Date().toISOString(), ...s }));
  const del = el("button", "", "Delete this site");
  del.type = "button";
  let armed = false;
  del.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      del.textContent = `Really forget ${site}?`;
      del.classList.add("danger");
      setTimeout(() => { armed = false; del.textContent = "Delete this site"; del.classList.remove("danger"); }, 4000);
      return;
    }
    await chrome.runtime.sendMessage({ type: "deleteSite", site });
    openSites.delete(site);
    await load();
    render();
  });
  row.append(exp, del);
  return row;
}

$("#export").addEventListener("click", () =>
  download(`reef-shadow-${today()}.json`, { exportedAt: new Date().toISOString(), settings: data.settings, sites: data.sites, signals: data.signals })
);
$("#retention").addEventListener("change", (e) =>
  chrome.storage.local.set({ settings: { ...data.settings, retentionDays: Number(e.target.value) } })
);

// ---------- Decoded view (plain words) ----------
const ROLE = {
  "data-broker": ["data broker", "Matches your browsing to profiles that data companies trade with each other."],
  advertising: ["advertising", "Builds a profile of your interests so you can be shown targeted ads, here and on other sites."],
  "session-replay": ["screen recorder", "Records your mouse movements, scrolling and clicks, like a screen recording of your visit."],
  analytics: ["analytics", "Studies how you use the site: which pages you open, for how long, and what you click."],
  social: ["social network", "Learns that you visited, and can link it to your account if you are logged in there."],
};
const ROLE_ORDER = ["data-broker", "advertising", "session-replay", "analytics", "social"];
const STRONG_FP = ["canvas", "webgl", "audio", "fonts"];
const plural = (n, one, many) => (n === 1 ? one : many);

function lifetime(days) {
  if (days >= 365) return "over a year";
  if (days >= 60) return "about " + Math.round(days / 30) + " months";
  return days + " day" + (days === 1 ? "" : "s");
}

// Number of distinct companies behind the tracking domains of a site
function countWatchers(s) {
  const names = new Set();
  for (const t of Object.values(s.trackers || {})) if (t.company && Trackers.TRACKING.has(t.cat)) names.add(t.company);
  return names.size;
}

function setView(next) {
  view = next;
  chrome.storage.local.set({ footprintView: next });
  const entries = Object.entries(data.sites);
  renderSummary(entries);
  renderSites(entries);
}

function buildDecoded(site, s, sc) {
  const box = el("div", "detail decoded");

  // who is watching: group domains by company
  const companies = {};
  const unknown = [];
  for (const [dom, t] of Object.entries(s.trackers || {})) {
    if (t.company) {
      const c = (companies[t.company] = companies[t.company] || { cats: new Set(), n: 0 });
      c.cats.add(t.cat);
      c.n += t.n;
    } else if (t.cat === "other") {
      unknown.push(dom);
    }
  }
  const watchers = Object.entries(companies)
    .filter(([, c]) => ROLE_ORDER.some((r) => c.cats.has(r)))
    .map(([name, c]) => ({ name, n: c.n, role: ROLE_ORDER.find((r) => c.cats.has(r)) }))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || b.n - a.n);

  // verdict
  const verdict = el("div", "verdict " + sc.cls);
  const count = watchers.length;
  verdict.append(
    el("b", "", count ? `${count} ${plural(count, "company", "companies")} watched you on ${site}` : `No well-known trackers were seen on ${site}`),
    el("p", "reason", { low: "Not much tracking here.", medium: "A normal amount of tracking for today's web.", high: "This site lets many outsiders follow what you do.", vhigh: "This site is full of outside trackers. Almost all of it is invisible to you." }[sc.cls])
  );
  box.append(verdict);

  // who
  if (watchers.length) {
    const ul = el("ul", "plain-list");
    for (const w of watchers) {
      const li = el("li");
      li.append(el("b", "", w.name), el("span", "chip " + w.role, ROLE[w.role][0]), el("span", "reason", ROLE[w.role][1]), blockButton({ company: w.name }));
      ul.append(li);
    }
    const wrap = el("div");
    wrap.append(el("h3", "", "Who was watching"), ul);
    if (unknown.length) wrap.append(el("p", "reason", `Also contacted, but not on our list of known trackers: ${unknown.slice(0, 8).join(", ")}${unknown.length > 8 ? " and " + (unknown.length - 8) + " more" : ""}.`));
    if (unknown.length) {
      const unk = el("div", "block-row");
      for (const d of unknown.slice(0, 6)) unk.append(blockButton({ domain: d }));
      wrap.append(unk);
    }
    box.append(wrap);
  }

  // what they could learn
  const learn = [];
  const params = Object.values(s.params || {});
  const ids = params.filter((p) => p.kind === "identifier");
  if (ids.length) learn.push(["A name tag for your browser", `${ids.length} identifier${ids.length === 1 ? " was" : "s were"} sent to ${new Set(ids.map((p) => p.d)).size} ${plural(new Set(ids.map((p) => p.d)).size, "company", "companies")}. Think of it as a code only they can read, which lets them recognise you again.`]);
  const thirdCookies = Object.values(s.cookies || {}).filter((c) => c.third);
  if (thirdCookies.length) {
    const longest = Math.max(...thirdCookies.map((c) => c.days));
    learn.push(["Tracking cookies from outsiders", `${thirdCookies.length} small ${plural(thirdCookies.length, "file was", "files were")} stored in your browser by other companies${longest ? ", the longest stays " + lifetime(longest) : ""}. They recognise you when you come back.`]);
  }
  const pageParams = params.filter((p) => p.kind === "page");
  if (pageParams.length) learn.push(["Which page you were reading", `The title or address of the page was passed to ${new Set(pageParams.map((p) => p.d)).size} ${plural(new Set(pageParams.map((p) => p.d)).size, "company", "companies")}.`]);
  const locParams = params.filter((p) => p.kind === "location");
  if (locParams.length) learn.push(["Your location", "Location details such as a city or coordinates were sent to outside companies."]);
  const deviceParams = params.filter((p) => p.kind === "device");
  const fp = Object.entries(s.fp || {}).filter(([k]) => !k.endsWith("|(site itself)"));
  const readTypes = new Set(fp.map(([k]) => k.split("|")[0]));
  if (deviceParams.length || ["hardware", "screen", "language", "timezone", "plugins"].some((t) => readTypes.has(t))) {
    learn.push(["Details about your computer", "Your screen size, language, time zone and hardware were read or sent out. Small details, but together they make your setup easy to recognise."]);
  }
  const strong = fp.filter(([k]) => STRONG_FP.includes(k.split("|")[0]));
  if (strong.length) {
    const hosts = [...new Set(strong.map(([k]) => k.split("|")[1]))];
    learn.push(["Your browser's fingerprint", `Scripts from ${hosts.slice(0, 3).join(", ")}${hosts.length > 3 ? " and others" : ""} drew hidden images or asked about your graphics card. This tells your computer apart from millions of others, even if you delete your cookies.`]);
  }
  if (readTypes.has("geolocation")) learn.push(["A request for your precise location", "A script asked your browser for your exact position."]);
  if (readTypes.has("beacon")) learn.push(["Data sent as you left", "Some information was sent in the background so it survives closing the page."]);
  if (params.some((p) => p.kind === "campaign")) learn.push(["Which ad or link brought you here", "Marketing codes in the address tell advertisers where you came from."]);
  learn.push(["Roughly where you are", "Every company contacted automatically sees your IP address, which reveals your approximate city."]);
  const learnWrap = el("div");
  learnWrap.append(el("h3", "", "What they could learn about you"));
  const learnList = el("ul", "plain-list");
  for (const [title, text] of learn) {
    const li = el("li");
    li.append(el("b", "", title), el("span", "reason", text));
    learnList.append(li);
  }
  learnWrap.append(learnList);
  box.append(learnWrap);

  // can they follow you?
  const names = new Set(watchers.map((w) => w.name));
  const elsewhere = {};
  for (const [other, o] of Object.entries(data.sites)) {
    if (other === site) continue;
    for (const t of Object.values(o.trackers || {})) if (t.company && names.has(t.company)) (elsewhere[t.company] = elsewhere[t.company] || new Set()).add(other);
  }
  const follow = Object.entries(elsewhere).sort((a, b) => b[1].size - a[1].size).slice(0, 4);
  const followWrap = el("div");
  followWrap.append(el("h3", "", "Could they follow you to other sites?"));
  if (follow.length) {
    const ul = el("ul", "plain-list");
    for (const [name, sites] of follow) {
      const li = el("li");
      li.append(el("b", "", name), el("span", "reason", `also watched you on ${sites.size} other site${sites.size === 1 ? "" : "s"} you visited: ${[...sites].slice(0, 3).join(", ")}${sites.size > 3 ? "…" : ""}`));
      ul.append(li);
    }
    followWrap.append(ul);
  } else {
    followWrap.append(el("p", "reason", watchers.length ? "None of these companies showed up on your other recorded sites yet. Browse more and this fills in." : "Nothing to follow here."));
  }
  box.append(followWrap);

  // what to do
  const tips = ["Install a tracker blocker such as uBlock Origin or Privacy Badger. It stops most of the companies above from loading at all."];
  if (thirdCookies.length) tips.push("In Chrome, open Settings, then Privacy and security, then Third-party cookies, and choose to block them.");
  if (strong.length) tips.push("Fingerprinting works without cookies. Browsers such as Firefox or Brave offer protection against it.");
  tips.push('On cookie banners, choose "Reject all" or the most limited option.');
  const tipsWrap = el("div");
  tipsWrap.append(el("h3", "", "What you can do"));
  const tipList = el("ul", "plain-list tips");
  for (const t of tips) tipList.append(el("li", "", t));
  tipsWrap.append(tipList);
  box.append(tipsWrap);
  return box;
}

// ---------- Digital twin ----------
function prop(name) {
  const w = "#eaf6f8";
  switch (name) {
    case "headphones":
      return `<path d="M86 96A44 44 0 0 1 174 96" stroke="#ff7a6b" stroke-width="8" fill="none" stroke-linecap="round"/><rect x="78" y="88" width="14" height="30" rx="6" fill="#ff7a6b"/><rect x="168" y="88" width="14" height="30" rx="6" fill="#ff7a6b"/>`;
    case "gamepad":
      return `<g transform="translate(184 262)"><rect width="62" height="32" rx="14" fill="${w}"/><rect x="12" y="14" width="14" height="4" fill="#0b2239"/><rect x="17" y="9" width="4" height="14" fill="#0b2239"/><circle cx="42" cy="12" r="3.5" fill="#ff7a6b"/><circle cx="50" cy="19" r="3.5" fill="#7fe0d4"/></g>`;
    case "laptop":
      return `<g transform="translate(14 270)"><rect x="6" width="56" height="36" rx="4" fill="${w}"/><rect x="11" y="5" width="46" height="26" rx="2" fill="#123a5a"/><rect y="38" width="68" height="6" rx="3" fill="#8fb8cc"/></g>`;
    case "bag":
      return `<g transform="translate(198 196)"><path d="M10 12A9 9 0 0 1 28 12" stroke="${w}" stroke-width="3" fill="none"/><rect y="12" width="38" height="42" rx="5" fill="#ffc46b"/></g>`;
    case "plane":
      return `<g transform="translate(196 34)"><path d="M0 14L52 0L36 40L26 24Z" fill="#7fe0d4"/><path d="M26 24L52 0" stroke="#0b2239" stroke-width="2"/></g>`;
    case "ball":
      return `<g transform="translate(34 66)"><circle r="17" fill="${w}"/><path d="M-17 0H17M0 -17V17" stroke="#0b2239" stroke-width="2"/></g>`;
    case "fork":
      return `<g transform="translate(26 176)" stroke="${w}" stroke-width="3" stroke-linecap="round"><path d="M4 0V22M12 0V22M20 0V22M4 22Q12 32 20 22M12 30V62"/></g>`;
    default:
      return "";
  }
}

function avatarSVG(av) {
  const unknown = !av.revealed;
  const bodyFill = unknown ? "#2a4b66" : { sporty: "#7fe0d4", streetwear: "#ff7a6b", outdoor: "#5aa469", smart: "#1b2b3a", luxury: "#c9a24b", casual: "#8fb8cc" }[av.style] || "#4a6a80";
  const head = unknown ? "#2f5473" : "#cfe0e8";
  const stroke = unknown ? ` stroke="#4e7fa0" stroke-width="2" stroke-dasharray="6 5"` : "";
  let outfit = "";
  if (!unknown) {
    if (av.style === "sporty") outfit = `<path d="M118 150V320M142 150V320" stroke="#0b2239" stroke-width="5" opacity=".35"/>`;
    if (av.style === "streetwear") outfit = `<path d="M96 156Q130 190 164 156" stroke="#0b2239" stroke-width="5" fill="none" opacity=".4"/><rect x="104" y="260" width="52" height="30" rx="8" fill="#0b2239" opacity=".25"/>`;
    if (av.style === "outdoor") outfit = `<path d="M130 150V320" stroke="#0b2239" stroke-width="4" opacity=".4"/>`;
    if (av.style === "smart") outfit = `<path d="M112 152L130 200L148 152Z" fill="#eaf6f8"/><path d="M125 176L135 176L138 250L130 262L122 250Z" fill="#ff7a6b"/>`;
    if (!av.style) outfit = `<text x="130" y="240" text-anchor="middle" font-size="40" fill="#cfe0e8" opacity=".6" font-family="Georgia, serif">?</text>`;
  }
  const hair = unknown
    ? ""
    : `<path d="M92 80A40 40 0 0 1 168 80" stroke="#8fb8cc" stroke-width="2" stroke-dasharray="4 4" fill="none"/><text x="130" y="48" text-anchor="middle" font-size="13" fill="#8fb8cc" font-style="italic">hair: ?</text>`;
  const face = unknown ? `<text x="130" y="118" text-anchor="middle" font-size="64" fill="#8fb8cc" font-family="Georgia, serif">?</text>` : "";
  const props = unknown ? "" : (av.props || []).map(prop).join("");
  return (
    `<svg viewBox="0 0 260 340" role="img" aria-label="Your digital twin">` +
    `<ellipse cx="130" cy="326" rx="76" ry="8" fill="rgba(0,0,0,.25)"/>` +
    `<path d="M62 330V212Q62 164 106 152L154 152Q198 164 198 212V330Z" fill="${bodyFill}"${stroke}/>` +
    `<rect x="114" y="126" width="32" height="34" rx="10" fill="${head}"${stroke}/>` +
    `<circle cx="130" cy="92" r="44" fill="${head}"${stroke}/>` +
    outfit + hair + face + props +
    `</svg>`
  );
}

function renderAttrs(wrap, attrs) {
  wrap.replaceChildren();
  for (const a of attrs) {
    const row = el("div", "attr");
    const rated = (data.feedback || {})[a.key];
    if (rated && rated.verdict === "wrong") row.classList.add("wrong");
    const line = el("div", "line");
    line.append(el("span", "label", a.label), el("span", "value" + (a.value ? "" : " unknown"), a.value || "?"));
    row.append(line);
    const conf = el("div", "conf");
    const track = el("div", "track");
    const bar = el("i");
    bar.style.width = Math.round(a.conf * 100) + "%";
    track.append(bar);
    conf.append(track, el("small", "", a.value ? `${Math.round(a.conf * 100)}% confident` : a.note || "no signal yet"));
    row.append(conf);
    if (a.evidence.length || (a.value && a.caveat)) {
      const d = el("details");
      d.append(el("summary", "", "Why?"));
      const ul = el("ul");
      for (const ev of a.evidence) ul.append(el("li", "", ev));
      if (a.value && a.caveat) ul.append(el("li", "", a.caveat));
      d.append(ul);
      row.append(d);
    }
    if (a.value) row.append(feedbackRow(a));
    wrap.append(row);
  }
}

// 3D stage (twin3d.js is loaded on demand). If WebGL is unavailable, fall back to the flat avatar.
let stage = null;
let currentAvatar = null; // the avatar currently shown in the 3D scene (after the user's corrections)
let stageFailed = false;
let stageLoading = null;
function ensureStage() {
  if (stage || stageFailed || stageLoading) return stageLoading;
  stageLoading = import("./twin3d.js")
    .then((mod) => {
      stage = mod.createTwinStage($("#stage3d"));
      stage.setTheme(theme);
      stage.setMode(stageMode);
      $("#avatar").hidden = true;
    })
    .catch(() => {
      stageFailed = true;
      $("#stage3d").hidden = true;
      $("#avatar").hidden = false;
      $(".stage-tools").hidden = true; // share and the rotate hint both need the 3D scene
      document.querySelector('.stage-switch button[data-stage="network"]').hidden = true; // the 3D network needs WebGL too
    })
    .finally(() => (stageLoading = null));
  return stageLoading;
}

async function renderTwin() {
  const twin = Twin.infer(data.signals, browserEnv());
  const fb = data.feedback || {};
  if (fb.style && fb.style.verdict === "wrong") twin.avatar.style = null; // user said the outfit guess is wrong
  if (fb.interests && fb.interests.verdict === "wrong") twin.avatar.props = [];
  $("#avatar").innerHTML = avatarSVG(twin.avatar);
  const pctDone = Math.round(twin.completeness * 100);
  $("#progress-bar").style.width = pctDone + "%";
  $("#progress-text").textContent = twin.avatar.pages
    ? `${pctDone}% complete · learned from ${twin.avatar.pages} page visit${twin.avatar.pages === 1 ? "" : "s"}`
    : "0% complete · browse for a while and your twin takes shape";
  const rated = Object.values(fb);
  if (rated.length) $("#progress-text").textContent += ` · you rated ${rated.length} guess${rated.length === 1 ? "" : "es"}: ${rated.filter((r) => r.verdict === "wrong").length} wrong`;
  renderAttrs($("#exposed"), twin.attrs.filter((a) => a.group === "exposed"));
  renderAttrs($("#inferred"), twin.attrs.filter((a) => a.group === "inferred"));
  currentAvatar = twin.avatar;
  renderFingerprint();
  await ensureStage();
  if (stage) stage.setTwin(twin.avatar);
}

// ---------- Fingerprint uniqueness ----------
let fpResult = null;
function renderFingerprint() {
  const box = $("#fp-card");
  box.replaceChildren();
  try {
    fpResult = fpResult || Fingerprint.measure();
  } catch {
    box.append(el("p", "hint", "The fingerprint test is not available in this browser."));
    return;
  }
  const r = fpResult;
  box.append(el("div", "eyebrow", "How easy is your browser to recognise?"));
  const head = el("div", "fp-head");
  head.append(el("b", "fp-band " + r.band.key, r.band.label), el("span", "reason", r.band.text));
  box.append(head);
  const meter = el("div", "fp-meter");
  for (let i = 0; i < 4; i++) meter.append(el("i", i <= r.band.level ? "on l" + r.band.level : ""));
  box.append(meter);
  box.append(el("p", "hint", `${r.readable} signals any website can read · ${r.rare} of them rare${r.protectedCount ? " · " + r.protectedCount + " protected by your browser" : ""}. This is a rough estimate from typical values, not a measurement of you against other people.`));
  const d = el("details");
  d.append(el("summary", "", `All ${r.signals.length} signals`));
  const ul = el("ul", "clean-list");
  for (const s of r.signals) {
    const li = el("li");
    const text = el("span", "grow");
    text.append(el("b", "", s.label), el("span", "reason", " " + s.value + (s.estimated ? " (estimated)" : "")));
    li.append(text, el("span", "chip " + (s.tier === "rare" ? "advertising" : s.tier === "protected" ? "analytics" : ""), s.tier));
    ul.append(li);
  }
  d.append(ul);
  box.append(d);
  const tips = el("ul", "clean-list tips");
  for (const t of r.tips) tips.append(el("li", "", t));
  box.append(tips);
}

// ---------- Share card ----------
const SAMPLE_ENV = { tz: "Europe/Berlin", langs: ["de-DE", "en"], platform: "MacIntel", cores: 8, memory: 8, screen: { w: 1512, h: 982 } };
const PRIVATE_BY_DEFAULT = ["location", "languages", "device"];

async function openShare() {
  if (!stage) return;
  const dlg = el("dialog", "share-dialog");
  const canvas = document.createElement("canvas");
  canvas.className = "share-canvas";
  const sampleBox = document.createElement("input");
  sampleBox.type = "checkbox";
  const sample = el("label", "share-sample");
  sample.append(sampleBox, " Use example data instead of mine");
  const opts = el("div", "share-opts");
  const note = el("p", "hint", "Made on this device, nothing is uploaded. Location, device and languages are left out by default because they identify you.");
  const msg = el("p", "hint");
  const actions = el("div", "share-actions");
  const dl = el("button", "primary", "Download PNG");
  const cp = el("button", "", "Copy image");
  const close = el("button", "", "Close");
  for (const b of [dl, cp, close]) b.type = "button";
  actions.append(dl, cp, close);
  dlg.append(el("h2", "", "Share my twin"), canvas, sample, opts, note, actions, msg);
  document.body.append(dlg);

  const picked = new Set();
  let current = null;
  const render = async () => {
    const real = Twin.infer(data.signals, browserEnv());
    current = sampleBox.checked ? Twin.infer(ShareCard.SAMPLE_SIGNALS, SAMPLE_ENV) : real;
    stage.setTwin(current.avatar);
    const url = stage.snapshot();
    stage.setTwin(currentAvatar || real.avatar); // put the real avatar back
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = url; });
    const rows = current.attrs.filter((a) => a.value && picked.has(a.key)).map((a) => ({ label: a.label, value: a.value, conf: a.conf }));
    ShareCard.draw(canvas, { avatarImg: img, rows, completeness: current.completeness });
  };
  const buildOptions = () => {
    const attrs = (sampleBox.checked ? Twin.infer(ShareCard.SAMPLE_SIGNALS, SAMPLE_ENV) : Twin.infer(data.signals, browserEnv())).attrs.filter((a) => a.value);
    picked.clear();
    opts.replaceChildren();
    for (const a of attrs) {
      if (!PRIVATE_BY_DEFAULT.includes(a.key)) picked.add(a.key);
      const lab = el("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = picked.has(a.key);
      cb.addEventListener("change", () => { cb.checked ? picked.add(a.key) : picked.delete(a.key); render(); });
      lab.append(cb, " " + a.label);
      opts.append(lab);
    }
  };
  sampleBox.addEventListener("change", () => { buildOptions(); render(); });
  dl.addEventListener("click", () => canvas.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "reef-digital-twin.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }));
  cp.addEventListener("click", () => canvas.toBlob(async (blob) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      msg.textContent = "Copied. Paste it into a post or chat.";
    } catch {
      msg.textContent = "Copying is not available here. Use Download PNG instead.";
    }
  }));
  close.addEventListener("click", () => {
    dlg.close();
    dlg.remove();
  });
  dlg.addEventListener("close", () => dlg.remove());
  buildOptions();
  dlg.showModal();
  render();
}

$("#share").addEventListener("click", openShare);

// ---------- Network: anonymous scores and protection recipes ----------
const SVGNS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const scoreColor = (s) => `hsl(${Math.round(5 + 165 * (s / 100))},70%,60%)`; // low = coral, high = aqua
const ordinal = (n) => n + (["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]);
const myScore = () => (data.score == null ? 60 : data.score);
let netSelected = null;
let netNote = "";

function saveNetwork(patch) {
  const next = { ...data.network, ...patch };
  if ((next.global || next.friends) && !next.anonId) next.anonId = Math.random().toString(36).slice(2, 8);
  data.network = next;
  chrome.storage.local.set({ networkSettings: next });
  netSelected = null;
  netNote = "";
  renderNetwork();
  renderToolkit();
  syncStageNetwork();
}

function netToggle(title, text, checked, onChange) {
  const label = el("label", "net-toggle");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = checked;
  cb.addEventListener("change", () => onChange(cb.checked));
  const copy = el("span");
  copy.append(el("b", "", title), el("small", "", text));
  label.append(cb, copy);
  return label;
}

function renderNetwork() {
  const snap = Network.snapshot({ score: myScore(), settings: data.network });
  renderNetPlace(snap);
  renderNetRecipe();
  renderNetGraph(snap);
  renderNetTop(snap);
  renderNetDetail(snap);
}

function renderNetPlace(snap) {
  const box = $("#net-place");
  box.replaceChildren();
  box.append(el("div", "eyebrow", "Your place"));
  const top = el("div", "weekly-top");
  const big = el("div", "weekly-big");
  big.append(el("b", "", String(myScore())), el("span", "", " privacy score"));
  top.append(big);
  if (data.score == null) top.append(el("span", "delta flat", "calibrating"));
  box.append(top);
  const lines = el("ul", "clean-list");
  const line = (text) => lines.append(el("li", "", text));
  line(snap.global ? `Globally you are in the top ${snap.global.topPercent}% (${ordinal(snap.global.rank)} of ${snap.global.total}).` : "Join the global network to see where you stand among everyone.");
  line(snap.friends ? `Among your friends you are ${ordinal(snap.friends.rank)} of ${snap.friends.total}.` : "Join your friends network to see where you stand among them.");
  box.append(lines);
  box.append(
    netToggle("Global network", "Anonymous. You see only your own position, never a list of others.", !!data.network.global, (v) => saveNetwork({ global: v })),
    netToggle("Friends network", "Anonymous names. You see your own place within your circle.", !!data.network.friends, (v) => saveNetwork({ friends: v })),
    el("p", "hint", "Both are off until you switch them on. Being in a network is how you see its ranking.")
  );
}

function renderNetRecipe() {
  const box = $("#net-recipe");
  box.replaceChildren();
  box.append(el("div", "eyebrow", "Your recipe"));
  const recipe = Network.myRecipe({ score: myScore(), settings: data.network, blockedCompanies: data.blocked.companies || [] });
  const preview = el("p", "net-preview");
  if (!recipe) {
    preview.textContent = "Nothing is shared. You are not in any network.";
  } else {
    const parts = [`${recipe.name} · score ${recipe.score}`];
    if (recipe.blocked.length) parts.push("blocks " + recipe.blocked.join(", "));
    if (recipe.tools.length) parts.push("uses " + recipe.tools.map(Network.toolLabel).join(", "));
    preview.textContent = "Others would see: " + parts.join(" · ") + ". Nothing else.";
  }
  box.append(preview);
  box.append(
    netToggle("Share which trackers I block", "Lets others adopt your blocklist.", data.network.shareBlocked !== false, (v) => saveNetwork({ shareBlocked: v })),
    netToggle("Share my privacy habits", "Only the ones you tick in your Toolkit.", data.network.shareHabits !== false, (v) => saveNetwork({ shareHabits: v }))
  );
  const habitsLink = el("button", "block-btn", "Edit my habits in the Toolkit");
  habitsLink.type = "button";
  habitsLink.addEventListener("click", () => gotoTab("toolkit", "#tk-habits"));
  box.append(habitsLink);
}

function nodeGlyph(g, r, score) {
  g.append(
    svgEl("circle", { r, fill: scoreColor(score), "fill-opacity": (0.18 + (score / 100) * 0.5).toFixed(2), stroke: scoreColor(score), "stroke-width": 2 }),
    svgEl("circle", { cy: -r * 0.22, r: r * 0.26, fill: "#eaf6f8", "fill-opacity": 0.85 }),
    svgEl("path", { d: `M${-r * 0.42} ${r * 0.5} A${r * 0.42} ${r * 0.34} 0 0 1 ${r * 0.42} ${r * 0.5}`, fill: "#eaf6f8", "fill-opacity": 0.85 })
  );
}

function renderNetGraph(snap) {
  const host = $("#net-graph");
  host.replaceChildren();
  const msg = $("#net-graph-msg");
  const W = 680;
  const H = 620;
  const cx = W / 2;
  const cy = H / 2;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Your friends network" });
  svg.setAttribute("class", "net-svg");
  const nodes = snap.friends ? snap.friends.nodes : [];
  const pos = {};
  const ring1 = nodes.filter((n) => n.ring === 1);
  ring1.forEach((n, i) => {
    const a = (-90 + i * (360 / ring1.length)) * (Math.PI / 180);
    pos[n.id] = { x: cx + Math.cos(a) * 150, y: cy + Math.sin(a) * 150, a };
  });
  for (const f of ring1) {
    const kids = nodes.filter((n) => n.parent === f.id);
    kids.forEach((k, j) => {
      const a = pos[f.id].a + (j - (kids.length - 1) / 2) * 0.34;
      pos[k.id] = { x: cx + Math.cos(a) * 262, y: cy + Math.sin(a) * 262 };
    });
  }
  const links = svgEl("g");
  for (const n of nodes) {
    const from = n.parent === "me" ? { x: cx, y: cy } : pos[n.parent];
    if (from && pos[n.id]) links.append(svgEl("line", { x1: from.x, y1: from.y, x2: pos[n.id].x, y2: pos[n.id].y, stroke: "#4e7fa0", "stroke-opacity": 0.45, "stroke-width": n.ring === 1 ? 1.6 : 1 }));
  }
  svg.append(links);
  for (const n of nodes) {
    const p = pos[n.id];
    if (!p) continue;
    const r = n.ring === 1 ? 24 : 16;
    const g = svgEl("g", { transform: `translate(${p.x} ${p.y})`, tabindex: 0, role: "button", "aria-label": `${n.name}, score ${n.score}` });
    g.setAttribute("class", "net-node" + (netSelected === n.id ? " selected" : ""));
    nodeGlyph(g, r, n.score);
    const label = svgEl("text", { y: r + 14, "text-anchor": "middle", "font-size": 11 });
    label.textContent = `${n.name} · ${n.score}`;
    g.append(label);
    const choose = () => selectNode(n.id);
    g.addEventListener("click", choose);
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); } });
    svg.append(g);
  }
  const me = svgEl("g", { transform: `translate(${cx} ${cy})` });
  me.setAttribute("class", "net-me");
  nodeGlyph(me, 32, myScore());
  me.firstChild.setAttribute("stroke", "#7fe0d4");
  me.firstChild.setAttribute("stroke-width", 3);
  const meLabel = svgEl("text", { y: 48, "text-anchor": "middle", "font-size": 12 });
  meLabel.textContent = `You · ${myScore()}`;
  me.append(meLabel);
  svg.append(me);
  host.append(svg);
  msg.textContent = snap.friends ? "Coral means a low privacy score, aqua a high one. Click an avatar to see its recipe." : "Join your friends network (right) to see the avatars around you.";
  $("#net-graph-wrap").classList.toggle("dim", !snap.friends);
}

function renderNetTop(snap) {
  const box = $("#net-top");
  box.replaceChildren();
  box.append(el("h2", "", "Best-protected avatars"));
  if (!snap.global) {
    box.append(el("p", "hint", "Join the global network to see what the best-protected avatars do. They are anonymous: you see their score and their settings, nothing else."));
    return;
  }
  const ul = el("ul", "clean-list");
  for (const p of snap.topRecipes) {
    const li = el("li");
    const text = el("span", "grow");
    text.append(el("b", "", p.name), el("span", "reason", ` score ${p.score} · blocks ${p.blocked.length} · ${p.tools.length ? p.tools.map(Network.toolLabel).join(", ") : "no habits shared"}`));
    const view = el("button", "block-btn", "View recipe");
    view.type = "button";
    view.addEventListener("click", () => { netSelected = p.id; netNote = ""; renderNetGraph(snap); renderNetDetail(snap); $("#net-detail").scrollIntoView({ behavior: "smooth", block: "nearest" }); });
    li.append(text, view);
    ul.append(li);
  }
  box.append(ul);
}

function renderNetDetail(snap) {
  const box = $("#net-detail");
  box.replaceChildren();
  box.append(el("div", "eyebrow", "Recipe"));
  const pool = [...(snap.friends ? snap.friends.nodes : []), ...snap.topRecipes];
  let node = pool.find((n) => n.id === netSelected);
  if (!node && pool.length) node = [...pool].sort((a, b) => b.score - a.score)[0];
  if (!node) {
    box.append(el("p", "hint", "Join a network to see anonymous avatars and what they do to stay private. You learn how to hide; your twin never learns anything about them."));
    return;
  }
  const head = el("div", "weekly-top");
  const big = el("div", "weekly-big");
  big.append(el("b", "", node.name), el("span", "", " · anonymous avatar"));
  const pill = el("span", "delta flat", `score ${node.score}`);
  pill.style.color = scoreColor(node.score);
  pill.style.borderColor = scoreColor(node.score);
  head.append(big, pill);
  box.append(head);

  const blocked = data.blocked.companies || [];
  box.append(el("h3", "net-sub", node.blocked.length ? `Blocks ${node.blocked.length} tracking compan${node.blocked.length === 1 ? "y" : "ies"}` : "Blocks no companies"));
  const chips = el("div", "block-row");
  for (const c of node.blocked) chips.append(el("span", "chip " + (blocked.includes(c) ? "analytics" : "advertising"), blocked.includes(c) ? c + " ✓" : c));
  box.append(chips);
  const mine = Network.toAdopt(node, blocked);
  const adopt = el("button", "net-adopt", mine.length ? `Adopt this blocklist (${mine.length} new)` : node.blocked.length ? "You already block all of these" : "Nothing to adopt");
  adopt.type = "button";
  adopt.disabled = !mine.length;
  adopt.addEventListener("click", async () => {
    for (const c of mine) await chrome.runtime.sendMessage({ type: "blockTracker", company: c });
    netNote = `Now blocking ${mine.length} more compan${mine.length === 1 ? "y" : "ies"}. You can undo any of them in Footprint, under Blocked trackers.`;
    await load();
    render();
  });
  box.append(adopt);
  if (netNote) box.append(el("p", "hint", netNote));

  box.append(el("h3", "net-sub", "Habits"));
  if (node.tools.length) {
    const ul = el("ul", "clean-list tips");
    for (const id of node.tools) {
      const tool = Network.TOOLS.find((t) => t.id === id);
      if (tool) ul.append(el("li", "", `${tool.label}: ${tool.tip}`));
    }
    box.append(ul);
  } else {
    box.append(el("p", "hint", "This avatar did not share any habits."));
  }
  box.append(el("p", "hint", "You only see this avatar's score and settings. Not its sites, not its twin."));
}

// ---------- 3D scene mode: your digital twin | your network ----------
let stageMode = "twin";

function setStageMode(mode) {
  stageMode = mode;
  for (const b of document.querySelectorAll(".stage-switch button")) b.setAttribute("aria-selected", String(b.dataset.stage === mode));
  const net = mode === "network";
  $(".stage-bottom").hidden = net;
  $("#share").hidden = net;
  $("#stage-tip").textContent = net
    ? "Drag or scroll to rotate · pinch to zoom · click an avatar to see its recipe · double-click to reset"
    : "Drag or scroll to rotate · pinch to zoom · double-click to reset";
  if (stage) stage.setMode(mode);
  syncStageNetwork();
}

// Pick an avatar, from the 3D scene or the flat graph, and show it everywhere
// Clicking the avatar that is already selected deselects it
function selectNode(id) {
  setSelectedNode(id === netSelected ? null : id);
}

function setSelectedNode(id) {
  netSelected = id;
  netNote = "";
  const snap = Network.snapshot({ score: myScore(), settings: data.network });
  renderNetGraph(snap);
  renderNetDetail(snap);
  if (stage) stage.setSelected(netSelected);
  renderStageOverlay(snap);
}

async function adoptRecipe(node) {
  const mine = Network.toAdopt(node, data.blocked.companies || []);
  for (const c of mine) await chrome.runtime.sendMessage({ type: "blockTracker", company: c });
  netNote = `Now blocking ${mine.length} more compan${mine.length === 1 ? "y" : "ies"}. Undo any of them in Footprint, under Blocked trackers.`;
  await load();
  render();
}

function renderStageOverlay(snap) {
  const box = $("#stage-net");
  box.replaceChildren();
  if (!snap.friends) {
    box.append(el("p", "", "Join your friends network to see the avatars around you. The people here are simulated, nothing leaves your device."));
    const join = el("button", "primary", "Join friends network");
    join.type = "button";
    join.addEventListener("click", () => saveNetwork({ friends: true }));
    box.append(join);
    return;
  }
  const node = snap.friends.nodes.find((n) => n.id === netSelected);
  if (!node) {
    box.append(el("p", "", "Click an avatar to see what it does to stay private. Coral is a low privacy score, aqua a high one. The three pulsing green circles mark the best-protected avatars, the brightest being the best."));
    return;
  }
  const mine = Network.toAdopt(node, data.blocked.companies || []);
  const row = el("div", "row");
  const name = el("span", "grow");
  name.append(el("b", "", node.name), el("small", "", `  score ${node.score} · blocks ${node.blocked.length}`));
  const deselect = el("button", "", "✕ Deselect");
  deselect.type = "button";
  deselect.title = "Clear the selection (Esc)";
  deselect.addEventListener("click", () => setSelectedNode(null));
  const adopt = el("button", "primary", mine.length ? `Adopt blocklist (${mine.length} new)` : "Nothing new to adopt");
  adopt.type = "button";
  adopt.disabled = !mine.length;
  adopt.addEventListener("click", () => adoptRecipe(node));
  const full = el("button", "", "Full recipe");
  full.type = "button";
  full.addEventListener("click", () => document.querySelector('#tabs button[data-tab="network"]').click());
  row.append(name, adopt, full, deselect);
  box.append(row);
  if (netNote) box.append(el("p", "", netNote));
}

function syncStageNetwork() {
  const box = $("#stage-net");
  box.hidden = stageMode !== "network";
  if (stageMode !== "network") return;
  const snap = Network.snapshot({ score: myScore(), settings: data.network });
  if (stage) stage.setNetwork({ nodes: snap.friends ? snap.friends.nodes : [], myScore: myScore(), selectedId: netSelected, onSelect: selectNode });
  renderStageOverlay(snap);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && stageMode === "network" && netSelected && !document.querySelector("dialog[open]")) setSelectedNode(null);
});

document.querySelector(".stage-switch").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-stage]");
  if (b) setStageMode(b.dataset.stage);
});

// ---------- Toolkit: what you do to protect yourself ----------
const BLOCKER_HABITS = ["ublock", "badger", "ghostery", "firefox", "brave"];

function gotoTab(name, scrollTo) {
  document.querySelector(`#tabs button[data-tab="${name}"]`).click();
  if (scrollTo) setTimeout(() => $(scrollTo).scrollIntoView({ behavior: "smooth", block: "start" }), 60);
}

// Habits are kept with the network settings, so a ticked habit is also what others would see
function saveHabits(habits) {
  data.network = { ...data.network, habits };
  chrome.storage.local.set({ networkSettings: data.network });
  renderToolkit();
  renderNetwork();
  syncStageNetwork();
}

function actionButton(text, onClick) {
  const b = el("button", "block-btn", text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function toolkitSuggestions() {
  const out = [];
  const w = Report.weekly(data.days);
  const blocked = data.blocked.companies || [];
  const habits = data.network.habits || [];
  const tool = (id) => Network.TOOLS.find((t) => t.id === id);

  // 0. Reef only watches until a protection level is chosen
  if (data.protect.level === "off") {
    out.push({ text: "Reef is only watching. Pick a protection level to start cutting tracking tags off links and clearing tracker cookies.", action: actionButton("Use Balanced", () => changeProtect({ level: "balanced" })) });
  } else if (!data.protectStats.last && data.protect.autoClean === "off") {
    out.push({ text: "Tracker cookies from past browsing are still stored on this device. Clear them in one click.", action: actionButton("Go to Clean up", () => $("#tk-clean").scrollIntoView({ behavior: "smooth", block: "start" })) });
  }

  // 1. the companies that watched you most and are not blocked yet
  for (const c of (w.topCompanies || []).filter((c) => !blocked.includes(c.name) && Trackers.domainsFor(c.name).length).slice(0, 3)) {
    out.push({ text: `${c.name} watched you on ${c.sites} site${c.sites === 1 ? "" : "s"} this week, and you do not block it.`, action: blockButton({ company: c.name }) });
  }
  // 2. no tracker blocker or privacy browser ticked
  if (!BLOCKER_HABITS.some((h) => habits.includes(h))) {
    out.push({ text: `You have not ticked a tracker blocker or a privacy browser. ${tool("ublock").tip}`, action: actionButton("Open habits", () => $("#tk-habits").scrollIntoView({ behavior: "smooth", block: "start" })) });
  }
  // 3. a very distinctive browser
  try {
    fpResult = fpResult || Fingerprint.measure();
    if (fpResult.band.level >= 2 && !habits.includes("firefox") && !habits.includes("brave")) {
      out.push({ text: "Your browser looks very distinctive to websites, so it can be recognised without cookies. Firefox or Brave blunt several of those signals.", action: actionButton("See why", () => { gotoTab("twin"); document.querySelector('.mini-tabs button[data-pane="fingerprint"]').click(); }) });
    }
  } catch {}
  // 4. cookies and banners
  for (const id of ["cookies", "banners"]) {
    if (!habits.includes(id)) out.push({ text: tool(id).tip });
  }
  // 5. learn from others, and focus
  if (!data.network.global && !data.network.friends) {
    out.push({ text: "Join a network to see what better-protected avatars do. Their recipes can be adopted in one click.", action: actionButton("Open Network", () => gotoTab("network")) });
  }
  if (!(data.blocklist || []).length) {
    out.push({ text: "You have not blocked any distracting sites for focus yet. They usually carry a lot of tracking too.", action: el("a", "block-btn", "Add on new tab") });
    out[out.length - 1].action.href = "newtab.html";
  }
  return out.slice(0, 7);
}

function tkRow(title, detail, right) {
  const li = el("li", "tk-row");
  const text = el("span", "grow");
  text.append(el("b", "", title), el("span", "reason", " " + detail));
  li.append(text);
  if (right) li.append(right);
  return li;
}

function renderToolkit() {
  const w = Report.weekly(data.days);
  const parts = Report.healthParts(w, Protect.points(data.protect));
  const habits = data.network.habits || [];
  const blockedCount = (data.blocked.companies || []).length + (data.blocked.domains || []).length;

  // summary tiles
  const tiles = $("#tk-summary");
  tiles.replaceChildren();
  for (const [n, label] of [[parts.score, "privacy score"], [`${habits.length} of ${Network.TOOLS.length}`, "habits ticked"], [blockedCount, "trackers you block"], [w.blocked || 0, "requests stopped this week"]]) {
    const t = el("div", "tile");
    t.append(el("b", "", String(n)), el("span", "", label));
    tiles.append(t);
  }

  // active protections: what Reef itself does and measures
  const active = $("#tk-active");
  active.replaceChildren(el("h2", "", "Active protections"), el("p", "hint", "What Reef does for you right now."));
  const ul = el("ul", "clean-list");
  const on = (text) => el("span", "chip analytics", text);
  ul.append(
    tkRow("Tracker blocking", blockedCount ? `${blockedCount} blocked · ${w.blocked || 0} requests stopped this week` : "nothing blocked yet", actionButton("Manage", () => gotoTab("footprint", "#blocked"))),
    (() => {
      const edit = el("a", "block-btn", "Edit on new tab");
      edit.href = "newtab.html";
      return tkRow("Focus mode", `${(data.blocklist || []).length} distracting site${(data.blocklist || []).length === 1 ? "" : "s"} blocked during sessions`, edit);
    })(),
    tkRow("Protection level", data.protect.level === "off" ? "Reef only watches" : data.protect.level === "custom" ? "custom mix" : LEVEL_INFO[data.protect.level][1], on(data.protect.level)),
    tkRow("Recording", data.settings.tracking ? "Shadow is watching what sites collect" : "paused", on(data.settings.tracking ? "on" : "paused")),
    tkRow("Private windows", "never recorded, even if allowed", on("always")),
    tkRow("Sensitive sites", "adult, dating, medical and political-party sites are never recorded", on("always")),
    tkRow("Data retention", data.settings.retentionDays === 0 ? "kept until you delete it" : `deleted after ${data.settings.retentionDays == null ? 90 : data.settings.retentionDays} days`, on("on"))
  );
  active.append(ul);

  // habits: self-declared, because Reef cannot see other extensions or browser settings
  const hab = $("#tk-habits");
  hab.replaceChildren(el("h2", "", "Your habits"), el("p", "hint", "Reef cannot see your other extensions or browser settings, so you tick what you do."));
  const prog = el("div", "track");
  const bar = el("i");
  bar.style.width = Math.round((habits.length / Network.TOOLS.length) * 100) + "%";
  prog.append(bar);
  hab.append(prog);
  const hl = el("ul", "clean-list");
  for (const t of Network.TOOLS) {
    const li = el("li", "tk-habit");
    const label = el("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = habits.includes(t.id);
    cb.addEventListener("change", () => {
      const set = new Set(habits);
      cb.checked ? set.add(t.id) : set.delete(t.id);
      saveHabits([...set]);
    });
    label.append(cb, " " + t.label);
    li.append(label);
    if (!cb.checked) li.append(el("small", "", t.tip));
    hl.append(li);
  }
  hab.append(hl);

  // next steps
  const next = $("#tk-next");
  next.replaceChildren(el("h2", "", "Suggested next steps"));
  const steps = toolkitSuggestions();
  if (!steps.length) {
    next.append(el("p", "hint", "Nothing to add. Your toolkit covers the main things."));
  } else {
    const nl = el("ul", "clean-list");
    for (const s of steps) {
      const li = el("li", "tk-row");
      li.append(el("span", "grow", s.text));
      if (s.action) li.append(s.action);
      nl.append(li);
    }
    next.append(nl);
  }

  // what moves the score
  const score = $("#tk-score");
  score.replaceChildren(el("h2", "", "What moves your score"));
  if (!parts.hasData) {
    score.append(el("p", "hint", "Browse for a few days with recording on. Until then your score is a neutral 60."));
  } else {
    const sl = el("ul", "clean-list");
    const pts = (n, cls) => el("span", "chip " + cls, n);
    sl.append(
      tkRow("Starting point", "", el("b", "", String(parts.base))),
      tkRow(`${parts.companies} compan${parts.companies === 1 ? "y" : "ies"} watched you this week`, "", pts(`−${parts.exposure} points`, "advertising")),
      tkRow(`You blocked ${parts.sharePct}% of the tracking aimed at you`, "", pts(`+${parts.bonus} points`, "analytics")),
      ...(parts.protect ? [tkRow("Protections switched on", "", pts(`+${parts.protect} points`, "analytics"))] : []),
      ...(() => {
        const raw = parts.base - parts.exposure + parts.bonus + parts.protect;
        return raw > 100 ? [tkRow("Highest possible", "", pts("capped at 100", "analytics"))] : raw < 10 ? [tkRow("Lowest shown", "", pts("floor of 10", "advertising"))] : [];
      })(),
      tkRow("Your privacy score", "", el("b", "", `${parts.score} / 100`))
    );
    score.append(sl, el("p", "hint", "To raise it, block the companies that watch you most (see the next steps). Every blocked request counts towards the share."));
  }

  // the shareable part
  const rec = $("#tk-recipe");
  rec.replaceChildren(el("h2", "", "Your recipe"), el("p", "hint", "The part of your toolkit that others could see if you join a network."));
  const recipe = Network.myRecipe({ score: parts.score, settings: data.network, blockedCompanies: data.blocked.companies || [] });
  if (!recipe) {
    rec.append(el("p", "net-preview", "Nothing is shared. You are not in any network."));
  } else {
    const bits = [`${recipe.name} · score ${recipe.score}`];
    if (recipe.blocked.length) bits.push("blocks " + recipe.blocked.join(", "));
    if (recipe.tools.length) bits.push("uses " + recipe.tools.map(Network.toolLabel).join(", "));
    rec.append(el("p", "net-preview", "Others would see: " + bits.join(" · ") + ". Nothing else."));
  }
  rec.append(actionButton("Sharing settings", () => gotoTab("network")));

  renderProtect();
  renderClean();
  renderRights();
  renderGuided();
}

// ---------- Protection: what Reef can do for you ----------
const send = (msg) => chrome.runtime.sendMessage(msg);
let tuneOpen = false;
let cleanNote = "";

const LEVEL_INFO = {
  off: ["Off", "Reef only watches and explains. It changes nothing about your browsing."],
  relaxed: ["Relaxed", "Cuts tracking tags off links and tells websites not to track you. Nothing should break."],
  balanced: ["Balanced", "Relaxed, plus it clears tracker cookies once a day."],
  strict: ["Strict", "Balanced, plus it blocks every known ad and analytics tracker, opens the secure version of sites and clears tracker cookies every hour. A few sites may need pausing."],
};

async function changeProtect(patch) {
  await send({ type: "setProtect", patch });
  await load();
  render();
}

const ago = (ts) => {
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

// A list of domains with a remove button and a field to add one
function domainEditor(title, hint, list, onAdd, onRemove) {
  const wrap = el("div", "dom-edit");
  wrap.append(el("b", "", title), el("small", "", hint));
  const ul = el("ul", "dom-list");
  for (const d of list) {
    const li = el("li");
    const rm = el("button", "block-btn on", "Remove");
    rm.type = "button";
    rm.addEventListener("click", () => onRemove(d));
    li.append(el("span", "grow mono", d), rm);
    ul.append(li);
  }
  wrap.append(ul);
  const form = el("form", "dom-add");
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "example.com";
  input.setAttribute("aria-label", title);
  const add = el("button", "block-btn", "Add");
  add.type = "submit";
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const dom = Reef.normalizeDomain(input.value);
    if (dom) onAdd(dom);
  });
  form.append(input, add);
  wrap.append(form);
  return wrap;
}

function renderProtect() {
  const box = $("#tk-level");
  const p = data.protect;
  box.replaceChildren();
  const head = el("div", "head");
  head.append(el("h2", "", "Protection level"), el("span", "hint", "Reef only changes your browsing when you choose a level"));
  box.append(head);

  const seg = el("div", "level-seg");
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", "Protection level");
  for (const name of Protect.LEVELS) {
    const b = el("button", "", LEVEL_INFO[name][0]);
    b.type = "button";
    b.setAttribute("aria-pressed", String(p.level === name));
    b.addEventListener("click", () => changeProtect({ level: name }));
    seg.append(b);
  }
  box.append(seg, el("p", "level-desc", p.level === "custom" ? "Custom: your own mix of the switches below." : LEVEL_INFO[p.level][1]));

  const tune = el("details", "tune");
  tune.open = tuneOpen;
  tune.addEventListener("toggle", () => (tuneOpen = tune.open));
  tune.append(el("summary", "", "Fine-tune"));
  const body = el("div", "tune-body");
  body.append(
    netToggle("Remove tracking tags from links", "Cuts fbclid, gclid, utm_ and similar off an address before the page loads. The page looks the same.", p.stripParams, (v) => changeProtect({ stripParams: v })),
    netToggle("Tell sites not to track me", "Sends the Global Privacy Control and Do Not Track signals. Sites in many regions must respect them. Not every site does.", p.gpc, (v) => changeProtect({ gpc: v })),
    netToggle("Block all known ad and analytics trackers", "Everything on Reef's list, not only the companies you picked. Social buttons and embedded videos keep working.", p.blockAll, (v) => changeProtect({ blockAll: v })),
    netToggle("Open the secure version of sites", "Changes http:// to https://. Local addresses are left alone. A site with no secure version will not load until you pause it.", p.https, (v) => changeProtect({ https: v })),
    netToggle("Open sensitive sites in a private window", "Health, dating, adult and political-party sites reopen in a private window. Reef must be allowed in private windows.", p.privateSensitive, (v) => changeProtect({ privateSensitive: v }))
  );
  const clean = el("label", "tune-select");
  const sel = document.createElement("select");
  for (const [v, t] of [["off", "Off"], ["daily", "Once a day"], ["hourly", "Every hour"]]) sel.add(new Option(t, v));
  sel.value = p.autoClean;
  sel.addEventListener("change", () => changeProtect({ autoClean: sel.value }));
  clean.append(el("b", "", "Clear tracker cookies automatically"), sel);
  body.append(
    clean,
    domainEditor("Always open in a private window", "These sites reopen in a private window whenever you visit.", p.privateSites, (d) => send({ type: "privateSite", site: d, on: true }).then(refreshAfter), (d) => send({ type: "privateSite", site: d, on: false }).then(refreshAfter)),
    domainEditor("Paused sites", "Protection is off on these sites, for when a site misbehaves. Tracking tags, privacy signals, https and blocking all skip them.", p.paused, (d) => send({ type: "pauseSite", site: d, paused: true }).then(refreshAfter), (d) => send({ type: "pauseSite", site: d, paused: false }).then(refreshAfter))
  );
  tune.append(body);
  box.append(tune);
}

async function refreshAfter() {
  await load();
  render();
}

function renderClean() {
  const box = $("#tk-clean");
  const st = data.protectStats;
  box.replaceChildren(el("h2", "", "Clean up"), el("p", "hint", "Deletes the cookies tracking companies keep about you. Cookies of sites you sign in to (Google, Facebook and similar) and of sites you visit yourself are never touched."));
  const btn = el("button", "primary", "Clear tracker cookies now");
  btn.type = "button";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Cleaning…";
    const res = await send({ type: "cleanTrackers" });
    cleanNote = res && res.ok ? (res.removed ? `Removed ${res.removed} cookie${res.removed === 1 ? "" : "s"} from ${res.domains} tracking domains.` : "Nothing to remove. No tracker cookies were found.") : "Could not clean. Reload Reef on chrome://extensions and try again.";
    await load();
    renderToolkit();
  });
  box.append(btn);
  if (cleanNote) box.append(el("p", "net-preview", cleanNote));
  const ul = el("ul", "clean-list");
  ul.append(
    tkRow("Cleared so far", `${st.total || 0} cookie${st.total === 1 ? "" : "s"}`, null),
    tkRow("Last clean", st.last ? ago(st.last) + (st.lastAuto ? " (automatic)" : "") : "never", null),
    tkRow("Automatic", data.protect.autoClean === "off" ? "off" : data.protect.autoClean === "daily" ? "once a day" : "every hour", null)
  );
  box.append(ul);
}

// ---------- Ask companies what they know ----------
const DASHBOARDS = {
  Google: ["Google ad settings", "https://myadcenter.google.com"],
  Meta: ["Meta ad preferences", "https://accountscenter.facebook.com/ad_preferences"],
  Microsoft: ["Microsoft privacy dashboard", "https://account.microsoft.com/privacy"],
  LinkedIn: ["LinkedIn ad settings", "https://www.linkedin.com/psettings/advertising"],
  Amazon: ["Amazon ad preferences", "https://www.amazon.com/adprefs"],
};

function sitesSeenWith(company) {
  return Object.entries(data.sites)
    .filter(([, s]) => Object.values(s.trackers || {}).some((t) => t.company === company))
    .map(([k]) => k)
    .slice(0, 6);
}

function rightsLetter(company, law, sites) {
  const seen = sites.length ? ` Your technology is present on websites I visit, for example ${sites.join(", ")}.` : " Your technology is present on websites I visit.";
  const id = " If you need an identifier to find my data, such as a cookie ID, tell me how to provide it and I will send it.";
  if (law === "ccpa") {
    return `Subject: Request to know, delete and opt out (CCPA/CPRA)

To the privacy team of ${company},

I am a California resident and I am exercising my rights under the California Consumer Privacy Act.

1. Right to know: please tell me which categories and which specific pieces of personal information you have collected about me, where it came from, why you collected it and who you shared or sold it to.
2. Right to delete: please delete the personal information you hold about me.
3. Right to opt out: I opt out of the sale and sharing of my personal information, including for cross-context behavioural advertising.

${seen.trim()}${id}

Please confirm receipt and respond within the legal deadline.

Yours sincerely,
[Your name]
[Your email address]
`;
  }
  return `Subject: Request for access, objection and erasure (Art. 15, 21 and 17 GDPR)

To the Data Protection Officer of ${company},

I am exercising my rights under the General Data Protection Regulation.

1. Access (Art. 15): please confirm whether you process personal data about me. If you do, send me a copy, and tell me the purposes, the categories of data, the recipients, how long it is kept and where it came from.
2. Objection (Art. 21): I object to the use of my data for profiling and personalised advertising.
3. Erasure (Art. 17): please delete all personal data you hold about me.

${seen.trim()}${id}

Please reply within one month, as Article 12 requires.

Yours sincerely,
[Your name]
[Your email address]
`;
}

function openLetter(company) {
  const sites = sitesSeenWith(company);
  const dlg = el("dialog", "share-dialog letter");
  const sel = document.createElement("select");
  sel.add(new Option("GDPR (EU and UK)", "gdpr"));
  sel.add(new Option("CCPA (California)", "ccpa"));
  const withSites = document.createElement("input");
  withSites.type = "checkbox";
  withSites.checked = sites.length > 0;
  withSites.disabled = !sites.length;
  const sitesLabel = el("label", "share-sample");
  sitesLabel.append(withSites, " Mention websites where I met them");
  const area = document.createElement("textarea");
  area.rows = 16;
  area.spellcheck = false;
  const refresh = () => (area.value = rightsLetter(company, sel.value, withSites.checked ? sites : []));
  sel.addEventListener("change", refresh);
  withSites.addEventListener("change", refresh);
  refresh();
  const msg = el("p", "hint", "A template, not legal advice. Send it to the privacy contact in the company's privacy policy. Reef sends nothing itself.");
  const actions = el("div", "share-actions");
  const copy = el("button", "primary", "Copy letter");
  const mail = el("button", "", "Open email draft");
  const close = el("button", "", "Close");
  for (const b of [copy, mail, close]) b.type = "button";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(area.value);
      msg.textContent = "Copied.";
    } catch {
      area.select();
      msg.textContent = "Select the text and copy it with Ctrl or Cmd + C.";
    }
  });
  mail.addEventListener("click", () => {
    const lines = area.value.split("\n");
    const subject = lines[0].replace(/^Subject:\s*/, "");
    chrome.tabs.create({ url: "mailto:?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(lines.slice(2).join("\n")) });
  });
  close.addEventListener("click", () => { dlg.close(); dlg.remove(); });
  actions.append(copy, mail, close);
  const dash = DASHBOARDS[company];
  dlg.append(el("h2", "", `Ask ${company} what it knows`), el("label", "share-sample", "Law: "), sel, sitesLabel, area);
  if (dash) {
    const link = el("a", "block-btn", `Also open: ${dash[0]}`);
    link.href = dash[1];
    link.target = "_blank";
    link.rel = "noopener";
    dlg.append(link);
  }
  dlg.append(msg, actions);
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

function renderRights() {
  const box = $("#tk-rights");
  box.replaceChildren(el("h2", "", "Ask companies what they know"), el("p", "hint", "Companies that watched you most this week. Reef writes a ready-made request for access and deletion. You send it."));
  const list = (Report.weekly(data.days).topCompanies || []).filter((c) => c.name);
  if (!list.length) {
    box.append(el("p", "hint", "Nothing yet. Browse for a few days with recording on."));
    return;
  }
  const ul = el("ul", "clean-list");
  for (const c of list) ul.append(tkRow(c.name, `watched you on ${c.sites} site${c.sites === 1 ? "" : "s"}`, actionButton("Write request", () => openLetter(c.name))));
  box.append(ul);
}

// ---------- Fix it in your browser and accounts ----------
function renderGuided() {
  const box = $("#tk-guided");
  box.replaceChildren(el("h2", "", "Fix it in your browser and accounts"), el("p", "hint", "Reef cannot change these for you. The buttons open the right page."));
  const items = [
    ["Block third-party cookies", "Chrome", "chrome://settings/cookies"],
    ["Always use secure connections", "Chrome", "chrome://settings/security"],
    ["Turn off ad personalisation", "Chrome", "chrome://settings/adPrivacy"],
    ["Clear browsing data", "Chrome", "chrome://settings/clearBrowserData"],
    ["Allow Reef in private windows", "Chrome", "chrome://extensions/?id=" + chrome.runtime.id],
    ["Google ad settings", "Google", "https://myadcenter.google.com"],
    ["Auto-delete Google activity", "Google", "https://myactivity.google.com/activitycontrols"],
    ["Meta ad preferences", "Meta", "https://accountscenter.facebook.com/ad_preferences"],
    ["Microsoft privacy dashboard", "Microsoft", "https://account.microsoft.com/privacy"],
    ["Amazon ad preferences", "Amazon", "https://www.amazon.com/adprefs"],
  ];
  const ul = el("ul", "clean-list");
  for (const [title, who, url] of items) ul.append(tkRow(title, who, actionButton("Open", () => chrome.tabs.create({ url }))));
  box.append(ul, el("p", "hint", "The account pages belong to those companies and may move."));
}

// ---------- Per-site actions ----------
function siteProtect(site, s) {
  const row = el("div", "site-actions site-protect");
  const note = el("span", "hint");
  const btn = (text, onClick, cls) => {
    const b = el("button", cls || "", text);
    b.type = "button";
    b.addEventListener("click", onClick);
    row.append(b);
    return b;
  };
  // 1. block every tracking company seen here
  const companies = [...new Set(Object.values(s.trackers || {}).filter((t) => t.company && Trackers.TRACKING.has(t.cat) && Trackers.domainsFor(t.company).length).map((t) => t.company))].filter((c) => !isCompanyBlocked(c));
  if (companies.length) {
    btn(`Block all ${companies.length} tracker compan${companies.length === 1 ? "y" : "ies"} here`, async () => {
      await send({ type: "blockMany", companies });
      await refreshAfter();
    });
  }
  // 2. clean cookies
  btn("Clear its trackers' cookies", async (e) => {
    e.target.disabled = true;
    const res = await send({ type: "cleanTrackers", site });
    note.textContent = res && res.ok ? (res.removed ? `Removed ${res.removed} tracker cookie${res.removed === 1 ? "" : "s"}.` : "No tracker cookies found.") : "Could not clean.";
    e.target.disabled = false;
  });
  let armed = false;
  const full = btn("Clear everything it stored", async () => {
    if (!armed) {
      armed = true;
      full.textContent = "Sure? You will be signed out";
      full.classList.add("danger");
      setTimeout(() => { armed = false; full.textContent = "Clear everything it stored"; full.classList.remove("danger"); }, 4000);
      return;
    }
    const res = await send({ type: "cleanTrackers", site, firstParty: true });
    armed = false;
    full.textContent = "Clear everything it stored";
    full.classList.remove("danger");
    note.textContent = res && res.ok ? "Cleared its cookies, saved data and its trackers' cookies." : "Could not clean.";
  }, "");
  full.title = "Deletes this site's cookies and saved data on this device, plus its trackers' cookies. You will be signed out of it. Your history stays.";
  // 3. private window
  btn("Open in private window", async () => {
    const res = await send({ type: "openPrivate", url: "https://" + site });
    note.textContent = res && res.ok ? "Opened." : (res && res.error) || "Could not open.";
  });
  const isPrivate = data.protect.privateSites.includes(site);
  btn(isPrivate ? "Always private: on" : "Always open in private", async () => {
    await send({ type: "privateSite", site, on: !isPrivate });
    await refreshAfter();
  }, isPrivate ? "on" : "");
  // 4. pause
  const isPaused = data.protect.paused.includes(site);
  btn(isPaused ? "Protection paused · resume" : "Pause protection here", async () => {
    await send({ type: "pauseSite", site, paused: !isPaused });
    await refreshAfter();
  }, isPaused ? "on" : "");
  row.append(note);
  return row;
}

// ---------- Controls ----------
function renderControls() {
  $("#tracking").checked = data.settings.tracking;
  $("#retention").value = String(data.settings.retentionDays == null ? 90 : data.settings.retentionDays);
  $("#tracking-label").textContent = data.settings.tracking ? "Recording" : "Paused";
  const btn = $("#clear");
  btn.textContent = confirmingClear ? "Really delete everything?" : "Delete all data";
  btn.classList.toggle("danger", confirmingClear);
}

document.querySelector(".themes").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-theme]");
  if (!btn) return;
  const name = btn.dataset.theme;
  applyTheme(name);
  chrome.storage.local.set({ shadowTheme: name });
});

$("#tracking").addEventListener("change", (e) => {
  if (e.target.checked && !data.settings.welcomed) {
    location.href = "welcome.html"; // recording needs the user's explicit yes first
    return;
  }
  chrome.storage.local.set({ settings: { ...data.settings, tracking: e.target.checked } });
});
$("#clear").addEventListener("click", async () => {
  if (!confirmingClear) {
    confirmingClear = true;
    renderControls();
    setTimeout(() => { confirmingClear = false; renderControls(); }, 4000);
    return;
  }
  confirmingClear = false;
  await chrome.storage.local.remove(["sites", "signals", "signalDays"]);
});

// Tabs inside the twin details card: Guesses | Fingerprint
document.querySelector(".mini-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-pane]");
  if (!btn) return;
  for (const b of document.querySelectorAll(".mini-tabs button")) b.setAttribute("aria-selected", String(b === btn));
  for (const name of ["guesses", "fingerprint"]) $("#pane-" + name).hidden = name !== btn.dataset.pane;
});

$("#tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (!btn) return;
  const tab = btn.dataset.tab;
  for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("active", b.dataset.tab === tab);
  for (const name of ["footprint", "twin", "network", "toolkit"]) $("#tab-" + name).hidden = name !== tab;
  history.replaceState(null, "", "#" + tab);
});

// Ask the background recorder whether it is alive, and say so
async function checkStatus() {
  const el = $("#status");
  let s = null;
  try {
    s = await Promise.race([chrome.runtime.sendMessage({ type: "shadowStatus" }), new Promise((r) => setTimeout(() => r(null), 3000))]);
  } catch {}
  if (!s) {
    el.className = "status bad";
    el.textContent = "The recorder is not answering, so nothing is being recorded. Open chrome://extensions, click the reload icon on Reef, then reload the pages you want to track.";
  } else if (s.requests === undefined) {
    el.className = "status bad";
    el.textContent = "Chrome is still running an old version of Reef in the background. Open chrome://extensions, click the reload icon on Reef, then reload the pages you want to track.";
  } else if (!s.tracking) {
    el.className = "status";
    if (s.welcomed) {
      el.textContent = "Recording is paused.";
    } else {
      const link = document.createElement("a");
      link.href = "welcome.html";
      link.textContent = "Review what Reef records and start";
      el.replaceChildren("Recording has not been switched on yet. ", link, ".");
    }
  } else if (s.errors) {
    el.className = "status bad";
    el.textContent = `Recorder problem (${s.errors} error${s.errors === 1 ? "" : "s"}): ${s.lastError}`;
  } else {
    el.className = "status ok";
    const last = s.lastSite ? ` · last page: ${s.lastSite}` : "";
    const aud = s.lastAudience ? ` · last audience signal: ${s.lastAudience.site} (${s.lastAudience.hint === "m" ? "men's" : "women's"} section)` : "";
    el.textContent = `Recording is active · ${s.pages} page${s.pages === 1 ? "" : "s"} seen since the recorder last started · ${s.sites} saved${last}${aud}`;
  }
}

function render() {
  const entries = Object.entries(data.sites);
  renderControls();
  renderEnv();
  renderWeekly();
  renderSummary(entries);
  renderBlocked();
  renderDistracting();
  renderSites(entries);
  renderTwin();
  renderNetwork();
  renderToolkit();
  syncStageNetwork();
}

// Re-render when data changes, but not while the user is reading an open site
chrome.storage.onChanged.addListener(() => {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(async () => {
    await load();
    if (document.querySelector(".site[open]")) {
      renderControls();
      renderWeekly();
      renderSummary(Object.entries(data.sites));
      renderBlocked();
      renderDistracting();
      renderTwin();
      renderNetwork();
      renderToolkit();
      syncStageNetwork();
    } else {
      render();
    }
  }, 500);
});

(async () => {
  checkStatus();
  setInterval(checkStatus, 5000);
  await load();
  render();
  const startTab = location.hash.slice(1);
  if (["footprint", "network", "toolkit"].includes(startTab)) document.querySelector(`#tabs button[data-tab="${startTab}"]`).click();
})();
