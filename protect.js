// Protection settings and the browser rules they turn into. Pure functions, shared by the
// service worker (which applies them) and the pages (which show and change them).
//
// Stored under "protect": { level, stripParams, gpc, https, blockAll, autoClean, privateSensitive, privateSites, paused }
const Protect = (() => {
  // Rule ids: focus < 10000, tracker blocking 10000..19999, these from 20000 upwards
  const RULE_BASE = 20000;

  // Link tracking added to addresses by ad and mail tools. Removing them never changes the page you get.
  const PARAMS = [
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
    "fbclid", "gclid", "gbraid", "wbraid", "dclid", "msclkid", "yclid", "twclid", "ttclid", "igshid",
    "mc_eid", "mc_cid", "_hsenc", "_hsmi", "mkt_tok", "vero_id",
  ];

  // Sites people sign in to. Their cookies are never cleaned, even though they also track.
  const KEEP = [
    "google.com", "youtube.com", "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com",
    "microsoft.com", "live.com", "office.com", "bing.com", "amazon.com", "apple.com", "github.com", "paypal.com",
  ];

  const FEATURES = ["stripParams", "gpc", "https", "blockAll", "autoClean"];
  const PRESETS = {
    off: { stripParams: false, gpc: false, https: false, blockAll: false, autoClean: "off" },
    relaxed: { stripParams: true, gpc: true, https: false, blockAll: false, autoClean: "off" },
    balanced: { stripParams: true, gpc: true, https: false, blockAll: false, autoClean: "daily" },
    strict: { stripParams: true, gpc: true, https: true, blockAll: true, autoClean: "hourly" },
  };
  const LEVELS = ["off", "relaxed", "balanced", "strict"];
  const CLEAN_MODES = ["off", "daily", "hourly"];

  const DEFAULTS = { level: "off", ...PRESETS.off, privateSensitive: false, privateSites: [], paused: [] };

  const domainList = (list) => [...new Set((Array.isArray(list) ? list : []).map((d) => String(d || "").toLowerCase().replace(/^www\./, "").trim()).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))].slice(0, 200);

  // Which named level the switches add up to, or "custom"
  function levelOf(s) {
    for (const name of LEVELS) if (FEATURES.every((f) => s[f] === PRESETS[name][f])) return name;
    return "custom";
  }

  // Fill in anything missing and drop anything invalid. Choosing a level applies its preset first.
  function normalize(raw, patch) {
    let s = { ...DEFAULTS, ...(raw || {}) };
    if (patch) {
      if (LEVELS.includes(patch.level)) s = { ...s, ...PRESETS[patch.level] };
      s = { ...s, ...patch };
    }
    const out = {
      stripParams: !!s.stripParams,
      gpc: !!s.gpc,
      https: !!s.https,
      blockAll: !!s.blockAll,
      autoClean: CLEAN_MODES.includes(s.autoClean) ? s.autoClean : "off",
      privateSensitive: !!s.privateSensitive,
      privateSites: domainList(s.privateSites),
      paused: domainList(s.paused),
    };
    out.level = levelOf(out);
    return out;
  }

  // Small score bonus for protections that really reduce what is sent about you
  function points(s) {
    if (!s) return 0;
    return (s.stripParams ? 2 : 0) + (s.gpc ? 2 : 0) + (s.https ? 1 : 0) + (s.autoClean !== "off" ? 3 : 0);
  }

  const ALL_TYPES = ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "media", "websocket", "other"];

  // Addresses that must stay on http: local machines, private networks, single-word hosts, explicit ports
  const LOCAL_HTTP = "^http://([^/]*:[0-9]+|localhost|127\\.|10\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|169\\.254\\.|\\[|[^/.:]+(/|$)|[^/]*\\.(local|lan|home|internal|test|localhost)(/|:|$))";

  // The browser rules for these settings (declarativeNetRequest format)
  function rules(s, base = RULE_BASE) {
    const out = [];
    const paused = s.paused && s.paused.length ? s.paused : undefined;
    const excl = (c) => (paused ? { ...c, excludedRequestDomains: paused } : c);
    let id = base;
    if (s.stripParams) {
      out.push({
        id: id++,
        priority: 1,
        action: { type: "redirect", redirect: { transform: { queryTransform: { removeParams: PARAMS } } } },
        condition: excl({ regexFilter: "^https?://[^#]*[?&](" + PARAMS.join("|") + ")=", resourceTypes: ["main_frame"] }),
      });
    }
    if (s.gpc) {
      out.push({
        id: id++,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "Sec-GPC", operation: "set", value: "1" },
            { header: "DNT", operation: "set", value: "1" },
          ],
        },
        condition: excl({ resourceTypes: ALL_TYPES }),
      });
    }
    if (s.https) {
      out.push({
        id: id++,
        priority: 1,
        action: { type: "upgradeScheme" },
        condition: excl({ regexFilter: "^http://", resourceTypes: ["main_frame"] }),
      });
      out.push({ id: id++, priority: 2, action: { type: "allow" }, condition: { regexFilter: LOCAL_HTTP, resourceTypes: ["main_frame"] } });
    }
    return out;
  }

  // Does this host belong to a listed domain (or one of its subdomains)?
  const matches = (host, list) => {
    const h = String(host || "").toLowerCase().replace(/^www\./, "");
    return (list || []).some((d) => h === d || h.endsWith("." + d));
  };

  const CLEAN_MINUTES = { hourly: 60, daily: 1440 };

  return { RULE_BASE, PARAMS, KEEP, PRESETS, LEVELS, CLEAN_MODES, CLEAN_MINUTES, DEFAULTS, normalize, levelOf, points, rules, matches, domainList };
})();
