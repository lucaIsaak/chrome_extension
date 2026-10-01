const $ = (sel) => document.querySelector(sel);

let data = { sites: {}, signals: null, settings: { tracking: true } };
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
  const stored = await chrome.storage.local.get(["sites", "signals", "settings", "shadowTheme", "footprintView"]);
  applyTheme(stored.shadowTheme);
  view = stored.footprintView === "raw" ? "raw" : "decoded";
  data = { sites: stored.sites || {}, signals: stored.signals || null, settings: { tracking: true, ...(stored.settings || {}) } };
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
    li.append(row, track);
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
    const fill = () => d.append(view === "decoded" ? buildDecoded(site, s, sc) : buildDetail(site, s, sc));
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
      li.append(el("b", "", w.name), el("span", "chip " + w.role, ROLE[w.role][0]), el("span", "reason", ROLE[w.role][1]));
      ul.append(li);
    }
    const wrap = el("div");
    wrap.append(el("h3", "", "Who was watching"), ul);
    if (unknown.length) wrap.append(el("p", "reason", `Also contacted, but not on our list of known trackers: ${unknown.slice(0, 8).join(", ")}${unknown.length > 8 ? " and " + (unknown.length - 8) + " more" : ""}.`));
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
    wrap.append(row);
  }
}

// 3D stage (twin3d.js is loaded on demand). If WebGL is unavailable, fall back to the flat avatar.
let stage = null;
let stageFailed = false;
let stageLoading = null;
function ensureStage() {
  if (stage || stageFailed || stageLoading) return stageLoading;
  stageLoading = import("./twin3d.js")
    .then((mod) => {
      stage = mod.createTwinStage($("#stage3d"));
      stage.setTheme(theme);
      $("#avatar").hidden = true;
    })
    .catch(() => {
      stageFailed = true;
      $("#stage3d").hidden = true;
      $("#avatar").hidden = false;
      $(".stage-hint").hidden = true;
    })
    .finally(() => (stageLoading = null));
  return stageLoading;
}

async function renderTwin() {
  const twin = Twin.infer(data.signals, browserEnv());
  $("#avatar").innerHTML = avatarSVG(twin.avatar);
  const pctDone = Math.round(twin.completeness * 100);
  $("#progress-bar").style.width = pctDone + "%";
  $("#progress-text").textContent = twin.avatar.pages
    ? `${pctDone}% complete · learned from ${twin.avatar.pages} page visit${twin.avatar.pages === 1 ? "" : "s"}`
    : "0% complete · browse for a while and your twin takes shape";
  renderAttrs($("#exposed"), twin.attrs.filter((a) => a.group === "exposed"));
  renderAttrs($("#inferred"), twin.attrs.filter((a) => a.group === "inferred"));
  await ensureStage();
  if (stage) stage.setTwin(twin.avatar);
}

// ---------- Controls ----------
function renderControls() {
  $("#tracking").checked = data.settings.tracking;
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

$("#tracking").addEventListener("change", (e) => chrome.storage.local.set({ settings: { ...data.settings, tracking: e.target.checked } }));
$("#clear").addEventListener("click", async () => {
  if (!confirmingClear) {
    confirmingClear = true;
    renderControls();
    setTimeout(() => { confirmingClear = false; renderControls(); }, 4000);
    return;
  }
  confirmingClear = false;
  await chrome.storage.local.remove(["sites", "signals"]);
});

$("#tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (!btn) return;
  const tab = btn.dataset.tab;
  for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("active", b.dataset.tab === tab);
  for (const name of ["footprint", "twin"]) $("#tab-" + name).hidden = name !== tab;
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
    el.textContent = "Recording is paused.";
  } else if (s.errors) {
    el.className = "status bad";
    el.textContent = `Recorder problem (${s.errors} error${s.errors === 1 ? "" : "s"}): ${s.lastError}`;
  } else {
    el.className = "status ok";
    el.textContent = `Recording is active · ${s.pages} page${s.pages === 1 ? "" : "s"} seen since the recorder last started · ${s.sites} saved`;
  }
}

function render() {
  const entries = Object.entries(data.sites);
  renderControls();
  renderEnv();
  renderSummary(entries);
  renderSites(entries);
  renderTwin();
}

// Re-render when data changes, but not while the user is reading an open site
chrome.storage.onChanged.addListener(() => {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(async () => {
    await load();
    if (document.querySelector(".site[open]")) {
      renderControls();
      renderSummary(Object.entries(data.sites));
      renderTwin();
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
  if (location.hash === "#footprint") document.querySelector('#tabs button[data-tab="footprint"]').click();
})();
