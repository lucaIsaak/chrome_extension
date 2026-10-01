// "Shadow": records what websites collect about the user. Runs in the service worker.
// Everything is stored locally. Cookie values and page text are never stored.
//
// Storage keys:
//   sites   { [site]: { visits, first, last, cats[], trackers{}, cookies{}, params{}, fp{} } }
//   signals { cats{}, hours[24], days[7], domains{}, pages, since }
//   settings { tracking: bool }

const Shadow = (() => {
  const MAX_SITES = 300;
  const MAX_DOMAINS = 500;
  const MAX_TRACKERS = 120;
  const MAX_COOKIES = 120;
  const MAX_PARAMS = 80;

  const model = { sites: {}, signals: newSignals(), settings: { tracking: true } };
  let tabSites = {}; // tabId -> registrable domain of the page in that tab
  let saveTimer = null;

  function newSignals() {
    return { cats: {}, hours: Array(24).fill(0), days: Array(7).fill(0), domains: {}, pages: 0, since: Date.now() };
  }

  const loaded = Promise.all([
    chrome.storage.local.get(["sites", "signals", "settings"]),
    chrome.storage.session.get("tabSites").catch(() => ({})),
  ]).then(([local, session]) => {
    if (local.sites) model.sites = local.sites;
    if (local.signals) model.signals = { ...newSignals(), ...local.signals };
    if (local.settings) model.settings = { tracking: true, ...local.settings };
    tabSites = (session && session.tabSites) || {};
  });

  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(flush, 2000);
  }
  function flush() {
    saveTimer = null;
    chrome.storage.local.set({ sites: model.sites, signals: model.signals });
  }
  const persistTabs = () => chrome.storage.session.set({ tabSites }).catch(() => {});

  // Reset when the user deletes data, follow the pause setting
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.settings && changes.settings.newValue) model.settings = { tracking: true, ...changes.settings.newValue };
    if (changes.sites && !changes.sites.newValue) {
      model.sites = {};
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (changes.signals && !changes.signals.newValue) model.signals = newSignals();
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
    if (!model.settings.tracking || details.tabId < 0) return;
    let url;
    try {
      url = new URL(details.url);
    } catch {
      return;
    }

    if (details.type === "main_frame") {
      if (Cats.isSensitive(url.hostname)) {
        delete tabSites[details.tabId]; // sensitive site: record nothing
      } else {
        tabSites[details.tabId] = recordVisit(url.hostname);
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
    noteParams(s, reg, url, details);
    scheduleSave();
  }

  async function onHeaders(details) {
    await loaded;
    if (!model.settings.tracking || details.tabId < 0) return;
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

  chrome.webRequest.onBeforeRequest.addListener(onRequest, { urls: ["http://*/*", "https://*/*"] }, ["requestBody"]);
  chrome.webRequest.onHeadersReceived.addListener(onHeaders, { urls: ["http://*/*", "https://*/*"] }, ["responseHeaders", "extraHeaders"]);

  // ----- messages from page-bridge.js -----
  async function handle(msg, sender) {
    await loaded;
    if (!model.settings.tracking || !sender.tab || sender.tab.id < 0) return;
    const top = tabSites[sender.tab.id];
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
      if (Cats.isSensitive(text)) return;
      addCats(s, Cats.classifyText(text));
      scheduleSave();
    }
  }

  chrome.runtime.onSuspend.addListener(() => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      flush();
    }
  });

  return { handle };
})();
