// "Shadow": records what websites collect about the user. Runs in the service worker.
// Everything is stored locally. Cookie values and page text are never stored.
//
// Storage keys:
//   sites   { [site]: { visits, first, last, cats[], trackers{}, cookies{}, params{}, fp{} } }
//   signals { cats{}, hours[24], days[7], domains{}, pages, since }
//   signalDays { "YYYY-MM-DD": { cats, hours, days, domains, gender, pages } }  (so old data can expire)
//   settings { tracking: bool, welcomed: bool, retentionDays: number (0 = keep forever) }

const Shadow = (() => {
  const MAX_SITES = 300;
  const MAX_DOMAINS = 500;
  const MAX_TRACKERS = 120;
  const MAX_COOKIES = 120;
  const MAX_PARAMS = 80;

  const PRIVATE = "(private)"; // marker for tabs in private windows, which are never recorded
  const model = { sites: {}, signals: newSignals(), days: {}, settings: { tracking: false }, blocked: { companies: [], domains: [] } }; // off until the user agrees on the welcome page
  let blockedSet = new Set(); // every domain the user chose to block
  let protectPts = 0; // score bonus from switched-on protections
  let lastHealth = null;
  let tabSites = {}; // tabId -> registrable domain of the page in that tab
  const stats = { started: Date.now(), requests: 0, pages: 0, errors: 0, lastError: null, lastPage: null, lastSite: null, lastAudience: null };
  const lastPath = {}; // tabId -> address path already counted for the audience signal
  const fail = (e) => {
    stats.errors++;
    stats.lastError = String((e && e.message) || e);
  };
  let saveTimer = null;

  function newSignals() {
    return { cats: {}, hours: Array(24).fill(0), days: Array(7).fill(0), domains: {}, gender: { m: 0, f: 0, sites: {} }, pages: 0, since: Date.now() };
  }
  const newBucket = () => ({ cats: {}, hours: Array(24).fill(0), days: Array(7).fill(0), domains: {}, gender: { m: 0, f: 0, sites: {} }, pages: 0, trackReq: 0, watch: {}, blocked: { n: 0, byCompany: {} } });
  const dateKey = (ts) => {
    const d = new Date(ts);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  const bucket = () => {
    const b = model.days[dateKey(Date.now())] || (model.days[dateKey(Date.now())] = newBucket());
    b.trackReq = b.trackReq || 0; // buckets from older versions lack the weekly-report fields
    b.watch = b.watch || {};
    b.blocked = b.blocked || { n: 0, byCompany: {} };
    return b;
  };

  // Rebuild the running totals from the daily buckets (used after pruning or deleting a site)
  function rebuildSignals() {
    const sig = newSignals();
    sig.since = model.signals.since;
    for (const b of Object.values(model.days)) {
      for (const [c, n] of Object.entries(b.cats)) sig.cats[c] = (sig.cats[c] || 0) + n;
      b.hours.forEach((n, i) => (sig.hours[i] += n));
      b.days.forEach((n, i) => (sig.days[i] += n));
      sig.pages += b.pages;
      for (const [d, v] of Object.entries(b.domains)) (sig.domains[d] = sig.domains[d] || { n: 0 }).n += v.n;
      sig.gender.m += b.gender.m;
      sig.gender.f += b.gender.f;
      for (const [d, v] of Object.entries(b.gender.sites)) {
        const x = sig.gender.sites[d] || (sig.gender.sites[d] = { m: 0, f: 0 });
        x.m += v.m;
        x.f += v.f;
      }
    }
    const keep = Object.keys(sig.domains).sort((a, b) => sig.domains[b].n - sig.domains[a].n).slice(0, MAX_DOMAINS);
    sig.domains = Object.fromEntries(keep.map((d) => [d, sig.domains[d]]));
    model.signals = sig;
  }

  const loaded = Promise.all([
    chrome.storage.local.get(["sites", "signals", "settings", "signalDays", "blockedTrackers", "protect"]),
    chrome.storage.session.get("tabSites").catch(() => ({})),
  ]).then(([local, session]) => {
    if (local.sites) model.sites = local.sites;
    if (local.signals) model.signals = { ...newSignals(), ...local.signals };
    if (local.settings) model.settings = { tracking: false, ...local.settings };
    if (local.signalDays) {
      model.days = local.signalDays;
    } else if (model.signals.pages > 0) {
      // data from before daily buckets existed: keep it as one bucket so it can expire too
      model.days[dateKey(model.signals.since)] = JSON.parse(JSON.stringify({ ...newBucket(), ...model.signals, since: undefined }));
    }
    if (local.blockedTrackers) model.blocked = local.blockedTrackers;
    blockedSet = new Set(Trackers.blockDomains(model.blocked));
    protectPts = Protect.points(Protect.normalize(local.protect));
    tabSites = (session && session.tabSites) || {};
  });

  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(flush, 2000);
  }
  function flush() {
    saveTimer = null;
    const out = { sites: model.sites, signals: model.signals, signalDays: model.days };
    const health = Report.health(Report.weekly(model.days), protectPts);
    if (health !== lastHealth) {
      lastHealth = health;
      out.reefHealth = health; // small key the new tab can read cheaply
    }
    chrome.storage.local.set(out);
  }
  const persistTabs = () => chrome.storage.session.set({ tabSites }).catch(() => {});

  // Reset when the user deletes data, follow the pause setting
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.settings && changes.settings.newValue) {
      const before = model.settings.retentionDays;
      model.settings = { tracking: false, ...changes.settings.newValue };
      if (model.settings.retentionDays !== before) prune();
    }
    if (changes.protect) {
      protectPts = Protect.points(Protect.normalize(changes.protect.newValue));
      scheduleSave();
    }
    if (changes.blockedTrackers) {
      model.blocked = changes.blockedTrackers.newValue || { companies: [], domains: [] };
      blockedSet = new Set(Trackers.blockDomains(model.blocked));
    }
    if (changes.sites && !changes.sites.newValue) {
      model.sites = {};
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (changes.signals && !changes.signals.newValue) {
      model.signals = newSignals();
      model.days = {};
    }
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabSites[tabId]) {
      delete tabSites[tabId];
      persistTabs();
    }
  });

  function getSite(site) {
    let s = model.sites[site];
    if (!s) {
      const keys = Object.keys(model.sites);
      if (keys.length >= MAX_SITES) {
        const oldest = keys.sort((a, b) => model.sites[a].last - model.sites[b].last)[0];
        delete model.sites[oldest];
      }
      s = model.sites[site] = { visits: 0, first: Date.now(), last: Date.now(), cats: [], trackers: {}, cookies: {}, params: {}, fp: {} };
    }
    return s;
  }

  function addCats(site, cats) {
    for (const c of cats) {
      if (!site.cats.includes(c)) site.cats.push(c);
      model.signals.cats[c] = (model.signals.cats[c] || 0) + 1;
      bucket().cats[c] = (bucket().cats[c] || 0) + 1;
    }
  }

  function countAudience(site, hint) {
    const g = model.signals.gender || (model.signals.gender = { m: 0, f: 0, sites: {} });
    g[hint]++;
    const bg = bucket().gender;
    bg[hint]++;
    if (g.sites[site] || Object.keys(g.sites).length < 60) {
      const d = g.sites[site] || (g.sites[site] = { m: 0, f: 0 });
      d[hint]++;
      const bd = bg.sites[site] || (bg.sites[site] = { m: 0, f: 0 });
      bd[hint]++;
    }
    stats.lastAudience = { site, hint, at: Date.now() };
  }

  async function isPrivate(tabId) {
    try {
      return !!(await chrome.tabs.get(tabId)).incognito;
    } catch {
      return false;
    }
  }

  // Works out the site of a tab even if the page was loaded before the recorder started
  function siteForTab(tab) {
    if (tab.incognito || tabSites[tab.id] === PRIVATE) return null; // private windows are never recorded
    const known = tabSites[tab.id];
    if (known && model.sites[known]) return known;
    try {
      const host = new URL(tab.url).hostname;
      if (Cats.isSensitive(host)) return null;
      const site = recordVisit(host);
      stats.pages++;
      tabSites[tab.id] = site;
      persistTabs();
      return site;
    } catch {
      return null;
    }
  }

  function recordVisit(host) {
    const site = Reef.registrable(host);
    const s = getSite(site);
    const now = new Date();
    s.visits++;
    s.last = Date.now();
    const sig = model.signals;
    sig.pages++;
    sig.hours[now.getHours()]++;
    sig.days[now.getDay()]++;
    const b = bucket();
    b.pages++;
    b.hours[now.getHours()]++;
    b.days[now.getDay()]++;
    (b.domains[site] = b.domains[site] || { n: 0 }).n++;
    const d = sig.domains[site] || (sig.domains[site] = { n: 0 });
    d.n++;
    if (Object.keys(sig.domains).length > MAX_DOMAINS) {
      const least = Object.keys(sig.domains).sort((a, b) => sig.domains[a].n - sig.domains[b].n)[0];
      delete sig.domains[least];
    }
    addCats(s, Cats.classifyHost(host));
    return site;
  }

  // ----- request details -----
  const ID_NAME = /^(uid|user_?id|cid|client_?id|visitor(_?id)?|vid|sid|session(_?id)?|_ga|_gid|_fbp|fbp|gclid|fbclid|msclkid|ttclid|dclid|yclid|id|guid|uuid|device_?id|idfa|aaid|anonymous_?id|ajs_\w+|cookie_?id|tid|aid)$/i;
  const KINDS = [
    ["identifier", ID_NAME],
    ["location", /^(geo|lat|lon|lng|latitude|longitude|city|country|zip|postal|region|loc)$/i],
    ["device", /^(sr|vp|ul|ua|screen|res|resolution|width|height|dpr|lang|language|tz|timezone|platform|os|browser|cd|je|sd)$/i],
    ["page", /^(url|u|dl|dp|dt|dr|ref|referrer|referer|page|title|path|location|href)$/i],
    ["campaign", /^(utm_\w+|campaign|source|medium|gad_\w+)$/i],
  ];
  const kindOf = (name) => {
    for (const [kind, re] of KINDS) if (re.test(name)) return kind;
    return null;
  };

  function sampleOf(kind, value) {
    const v = String(value || "");
    if (kind === "identifier") return v.slice(0, 6) + (v.length > 6 ? "…" : "");
    return v.length > 14 ? v.slice(0, 14) + "…" : v;
  }

  function addParam(s, domain, name, value) {
    let kind = kindOf(name);
    if (!kind && /^[A-Za-z0-9_\-.]{20,}$/.test(String(value))) kind = "identifier"; // long random-looking value
    if (!kind) return;
    const key = domain + "|" + name;
    if (!s.params[key]) {
      if (Object.keys(s.params).length >= MAX_PARAMS) return;
      s.params[key] = { d: domain, k: name, kind, sample: sampleOf(kind, value), n: 0 };
    }
    s.params[key].n++;
  }

  function bodyPairs(text) {
    try {
      const out = [];
      const walk = (o, depth) => {
        if (depth > 1 || !o || typeof o !== "object") return;
        for (const [k, v] of Object.entries(o)) {
          if (v && typeof v === "object") walk(v, depth + 1);
          else out.push([k, String(v)]);
        }
      };
      walk(JSON.parse(text), 0);
      return out.slice(0, 40);
    } catch {}
    if (text.includes("=")) {
      try {
        return [...new URLSearchParams(text)].slice(0, 40);
      } catch {}
    }
    return [];
  }

  function noteParams(s, domain, url, details) {
    for (const [k, v] of url.searchParams) addParam(s, domain, k, v);
    const body = details.requestBody;
    if (!body) return;
    if (body.formData) {
      for (const k of Object.keys(body.formData)) addParam(s, domain, k, (body.formData[k] || [])[0]);
    } else if (body.raw && body.raw[0] && body.raw[0].bytes) {
      try {
        const text = new TextDecoder().decode(body.raw[0].bytes).slice(0, 4000);
        for (const [k, v] of bodyPairs(text)) addParam(s, domain, k, v);
      } catch {}
    }
  }

  // ----- webRequest listeners -----
  async function onRequest(details) {
    await loaded;
    stats.requests++;
    if (!model.settings.tracking || details.tabId < 0) return;
    let url;
    try {
      url = new URL(details.url);
    } catch {
      return;
    }

    if (details.type === "main_frame") {
      if (await isPrivate(details.tabId)) {
        tabSites[details.tabId] = PRIVATE; // remember, so nothing from this tab is recorded
      } else if (Cats.isSensitive(url.hostname)) {
        delete tabSites[details.tabId]; // sensitive site: record nothing
      } else {
        tabSites[details.tabId] = recordVisit(url.hostname);
        stats.pages++;
        stats.lastPage = Date.now();
        stats.lastSite = tabSites[details.tabId];
        const pathHint = Cats.genderHint(url.pathname);
        if (pathHint) countAudience(tabSites[details.tabId], pathHint);
        lastPath[details.tabId] = url.pathname;
      }
      persistTabs();
      scheduleSave();
      return;
    }

    const top = tabSites[details.tabId];
    if (!top || !model.sites[top]) return;
    const reg = Reef.registrable(url.hostname);
    if (reg === top) return; // first party
    const s = model.sites[top];

    const known = Trackers.lookup(url.hostname);
    let t = s.trackers[reg];
    if (!t) {
      if (Object.keys(s.trackers).length >= MAX_TRACKERS) return;
      t = s.trackers[reg] = { n: 0, company: known ? known.company : null, cat: known ? known.cat : "other", types: {} };
    }
    t.n++;
    t.types[details.type] = (t.types[details.type] || 0) + 1;
    if (known && Trackers.TRACKING.has(known.cat)) {
      const b = bucket();
      b.trackReq++;
      if (b.watch[known.company] || Object.keys(b.watch).length < 200) {
        const w = (b.watch[known.company] = b.watch[known.company] || {});
        w[top] = (w[top] || 0) + 1;
      }
    }
    noteParams(s, reg, url, details);
    scheduleSave();
  }

  async function onHeaders(details) {
    await loaded;
    if (!model.settings.tracking || details.tabId < 0) return;
    if (tabSites[details.tabId] === PRIVATE) return;
    if (details.type === "main_frame" && (await isPrivate(details.tabId))) return;
    let host;
    try {
      host = new URL(details.url).hostname;
    } catch {
      return;
    }
    let top = tabSites[details.tabId];
    if (details.type === "main_frame") top = Reef.registrable(host);
    if (!top || !model.sites[top]) return;
    const s = model.sites[top];
    for (const h of details.responseHeaders || []) {
      if (h.name.toLowerCase() !== "set-cookie") continue;
      const parts = String(h.value || "").split(";");
      const name = parts[0].split("=")[0].trim();
      if (!name) continue;
      let days = 0;
      for (const p of parts.slice(1)) {
        const [a, b] = p.trim().split("=");
        const attr = a.toLowerCase();
        if (attr === "max-age") days = Number(b) / 86400;
        else if (attr === "expires" && !days) {
          const t = Date.parse(b);
          if (!isNaN(t)) days = (t - Date.now()) / 86400000;
        }
      }
      const key = host + "|" + name;
      if (!s.cookies[key] && Object.keys(s.cookies).length >= MAX_COOKIES) continue;
      s.cookies[key] = { d: host, name, days: Math.max(0, Math.round(days)), third: Reef.registrable(host) !== top };
    }
    scheduleSave();
  }

  // A request cancelled by the user's block list ends with "blocked by client"
  async function onBlocked(details) {
    await loaded;
    if (details.error !== "net::ERR_BLOCKED_BY_CLIENT" || details.tabId < 0) return;
    let host;
    try {
      host = new URL(details.url).hostname;
    } catch {
      return;
    }
    const reg = Reef.registrable(host);
    if (!blockedSet.has(reg) && !blockedSet.has(host)) return; // blocked by something else, not by Reef
    const known = Trackers.lookup(host);
    const name = known ? known.company : reg;
    const b = bucket();
    b.blocked.n++;
    b.blocked.byCompany[name] = (b.blocked.byCompany[name] || 0) + 1;
    const top = tabSites[details.tabId];
    if (top && model.sites[top]) {
      const s = model.sites[top];
      s.blockedN = (s.blockedN || 0) + 1;
      if (s.trackers[reg]) s.trackers[reg].blocked = (s.trackers[reg].blocked || 0) + 1;
    }
    scheduleSave();
  }

  // Errors are counted and shown on the Shadow page instead of silently stopping the recorder
  const guard = (fn) => async (details) => {
    try {
      await fn(details);
    } catch (e) {
      fail(e);
    }
  };
  try {
    const filter = { urls: ["http://*/*", "https://*/*"] };
    chrome.webRequest.onBeforeRequest.addListener(guard(onRequest), filter, ["requestBody"]);
    chrome.webRequest.onHeadersReceived.addListener(guard(onHeaders), filter, ["responseHeaders", "extraHeaders"]);
    chrome.webRequest.onErrorOccurred.addListener(guard(onBlocked), filter);
  } catch (e) {
    fail(e);
  }
  loaded.catch(fail);

  // ----- messages from page-bridge.js -----
  async function handle(msg, sender) {
    await loaded;
    if (!model.settings.tracking || !sender.tab || sender.tab.id < 0) return;
    const top = siteForTab(sender.tab);
    if (!top || !model.sites[top]) return;
    const s = model.sites[top];

    if (msg.type === "fp" && Array.isArray(msg.items)) {
      for (const it of msg.items.slice(0, 60)) {
        if (typeof it.t !== "string" || typeof it.h !== "string") continue;
        const where = Reef.registrable(it.h) === top ? "(site itself)" : Reef.registrable(it.h);
        const key = it.t.slice(0, 20) + "|" + where.slice(0, 80);
        if (!s.fp[key] && Object.keys(s.fp).length >= 80) continue;
        s.fp[key] = (s.fp[key] || 0) + (Number(it.n) || 1);
      }
      scheduleSave();
    } else if (msg.type === "page" && sender.frameId === 0) {
      // Classify the title and description locally, then discard the text.
      const text = String(msg.title || "") + " " + String(msg.desc || "");
      if (Cats.isSensitive(text + " " + String(msg.path || ""))) return;
      addCats(s, Cats.classifyText(text));
      // Shop sections such as /men/ or "Moda homem" (counts only; the address itself is not kept)
      const hint = Cats.genderHint(msg.path, msg.title);
      const alreadyCounted = msg.path && lastPath[sender.tab.id] === msg.path && Cats.genderHint(msg.path);
      if (hint && !alreadyCounted) countAudience(top, hint);
      if (msg.path) lastPath[sender.tab.id] = msg.path;
      stats.lastSite = top;
      scheduleSave();
    }
  }

  chrome.runtime.onSuspend.addListener(() => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      flush();
    }
  });

  // Remove data older than the retention setting (0 = keep forever)
  async function prune() {
    await loaded;
    const days = Number(model.settings.retentionDays == null ? 90 : model.settings.retentionDays);
    if (!days) return;
    const cutoff = Date.now() - days * 86400000;
    const cutKey = dateKey(cutoff);
    let changed = false;
    for (const [k, s] of Object.entries(model.sites)) {
      if (s.last < cutoff) {
        delete model.sites[k];
        changed = true;
      }
    }
    for (const k of Object.keys(model.days)) {
      if (k < cutKey) {
        delete model.days[k];
        changed = true;
      }
    }
    if (changed) {
      rebuildSignals();
      scheduleSave();
    }
  }

  // Forget one website: its record, its visits and its audience signals. Interests learned from it stay until old data expires.
  async function deleteSite(site) {
    await loaded;
    delete model.sites[site];
    for (const b of Object.values(model.days)) {
      if (b.domains[site]) {
        b.pages = Math.max(0, b.pages - b.domains[site].n);
        delete b.domains[site];
      }
      const g = b.gender.sites[site];
      if (g) {
        b.gender.m -= g.m;
        b.gender.f -= g.f;
        delete b.gender.sites[site];
      }
    }
    for (const id of Object.keys(tabSites)) if (tabSites[id] === site) delete tabSites[id];
    rebuildSignals();
    persistTabs();
    scheduleSave();
    return { ok: true };
  }

  async function status() {
    await loaded;
    return { ok: true, tracking: model.settings.tracking, welcomed: !!model.settings.welcomed, retentionDays: model.settings.retentionDays == null ? 90 : model.settings.retentionDays, sites: Object.keys(model.sites).length, ...stats };
  }

  loaded.then(() => prune()).catch(fail);

  return { handle, status, prune, deleteSite };
})();
