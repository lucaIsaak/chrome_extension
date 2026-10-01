// Browser fingerprint uniqueness: reads the signals any website can read and estimates how
// identifying they are. The shares below are rough, bundled approximations of how common each
// value is, not measurements. Nothing is sent anywhere. Result: a band, not an exact number.
const Fingerprint = (() => {
  const bits = (share) => -Math.log2(Math.max(share, 0.0005));

  const LANG = { "en-US": 0.3, "en-GB": 0.07, en: 0.05, "de-DE": 0.05, de: 0.02, "fr-FR": 0.04, "es-ES": 0.04, es: 0.02, "pt-BR": 0.05, "pt-PT": 0.01, "ja-JP": 0.03, "ru-RU": 0.04, "zh-CN": 0.04, "it-IT": 0.02, "nl-NL": 0.01 };
  const TZ = { "America/New_York": 0.1, "America/Chicago": 0.05, "America/Los_Angeles": 0.07, "America/Denver": 0.02, "Europe/London": 0.06, "Europe/Berlin": 0.05, "Europe/Paris": 0.04, "Europe/Madrid": 0.03, "Europe/Rome": 0.03, "Europe/Moscow": 0.04, "Asia/Kolkata": 0.07, "Asia/Shanghai": 0.05, "Asia/Tokyo": 0.03, "America/Sao_Paulo": 0.04, "Australia/Sydney": 0.02, "Europe/Lisbon": 0.01, "Europe/Amsterdam": 0.015, UTC: 0.02 };
  const SCREEN = { "1920x1080": 0.24, "1366x768": 0.08, "1536x864": 0.08, "1440x900": 0.05, "1280x720": 0.04, "2560x1440": 0.05, "1600x900": 0.03, "1680x1050": 0.015, "1512x982": 0.02, "1728x1117": 0.02, "1470x956": 0.015, "1440x960": 0.01, "390x844": 0.03, "393x852": 0.025, "412x915": 0.03, "360x800": 0.05 };
  const CORES = { 2: 0.07, 4: 0.25, 6: 0.12, 8: 0.3, 10: 0.04, 12: 0.07, 16: 0.06, 20: 0.02, 24: 0.02 };
  const MEMORY = { 2: 0.1, 4: 0.22, 8: 0.6 };
  const OS = { Windows: 0.62, macOS: 0.16, iOS: 0.08, Android: 0.06, Linux: 0.04, ChromeOS: 0.01 };
  const BROWSER = { Chrome: 0.62, Edge: 0.12, Safari: 0.15, Firefox: 0.06, Other: 0.05 };
  const GPU = [[/apple m\d|apple gpu/i, 0.08], [/intel/i, 0.25], [/nvidia|geforce|rtx|gtx/i, 0.22], [/amd|radeon/i, 0.1], [/adreno/i, 0.08], [/mali/i, 0.06], [/swiftshader|llvmpipe|software/i, 0.02]];
  const FONT_TEST = ["Arial", "Helvetica", "Times New Roman", "Courier New", "Verdana", "Georgia", "Palatino", "Garamond", "Comic Sans MS", "Trebuchet MS", "Impact", "Tahoma", "Calibri", "Cambria", "Consolas", "Menlo", "Monaco", "Lucida Grande", "Segoe UI", "Roboto", "Ubuntu", "Futura", "Gill Sans", "Optima", "Didot", "Baskerville", "Avenir", "Hoefler Text", "Papyrus", "Rockwell"];

  const tierOf = (b) => (b < 3 ? "common" : b < 7 ? "uncommon" : "rare");

  function osAndBrowser() {
    const ua = navigator.userAgent || "";
    const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    const p = platform + " " + ua;
    const os = /iPhone|iPad/i.test(p) ? "iOS" : /CrOS/i.test(p) ? "ChromeOS" : /Android/i.test(p) ? "Android" : /Mac/i.test(p) ? "macOS" : /Win/i.test(p) ? "Windows" : /Linux|X11/i.test(p) ? "Linux" : "Other";
    const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Other";
    return { os, browser };
  }

  function canvasHash() {
    const draw = () => {
      const c = document.createElement("canvas");
      c.width = 240;
      c.height = 60;
      const g = c.getContext("2d");
      g.textBaseline = "top";
      g.font = "16px Arial";
      g.fillStyle = "#f60";
      g.fillRect(10, 5, 90, 30);
      g.fillStyle = "#069";
      g.fillText("Reef \u{1F41A} fingerprint test, 123", 4, 18);
      g.strokeStyle = "rgba(102,204,0,0.7)";
      g.arc(150, 30, 20, 0, Math.PI * 1.7);
      g.stroke();
      return c.toDataURL();
    };
    const a = draw();
    const b = draw();
    let h = 2166136261;
    for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a.charCodeAt(i), 16777619);
    return { hash: (h >>> 0).toString(16).padStart(8, "0"), randomised: a !== b };
  }

  function gpu() {
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      if (!gl) return null;
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    } catch {
      return null;
    }
  }

  function fonts() {
    const span = document.createElement("span");
    span.textContent = "mmmmmmmmmmlli";
    span.style.cssText = "position:absolute;left:-9999px;font-size:72px;visibility:hidden;";
    document.body.append(span);
    const width = (family) => {
      span.style.fontFamily = family;
      return span.offsetWidth;
    };
    const base = { monospace: width("monospace"), serif: width("serif"), "sans-serif": width("sans-serif") };
    let found = 0;
    for (const f of FONT_TEST) {
      if (Object.keys(base).some((b) => width(`'${f}',${b}`) !== base[b])) found++;
    }
    span.remove();
    return found;
  }

  function measure() {
    const out = [];
    const add = (key, label, value, b, extra = {}) => out.push({ key, label, value, bits: b, tier: extra.protected ? "protected" : tierOf(b), ...extra });

    const { os, browser } = osAndBrowser();
    add("system", "Browser and system", `${browser} on ${os}`, bits(OS[os] || 0.02) + bits(BROWSER[browser] || 0.05) * 0.6);

    const langs = [...(navigator.languages || [navigator.language])];
    add("languages", "Languages", langs.slice(0, 3).join(", "), bits(LANG[langs[0]] || 0.01) + (langs.length > 2 ? 1 : 0));

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    add("timezone", "Time zone", tz, bits(TZ[tz] || 0.01));

    const size = `${screen.width}x${screen.height}`;
    const dpr = window.devicePixelRatio || 1;
    add("screen", "Screen", `${size} at ${dpr}x`, bits(SCREEN[size] || 0.01) + (dpr % 1 ? 0.7 : 0));

    const cores = navigator.hardwareConcurrency;
    add("cores", "CPU cores", cores ? String(cores) : "hidden", cores ? bits(CORES[cores] || 0.03) : 0);

    const mem = navigator.deviceMemory;
    add("memory", "Memory", mem ? `${mem}+ GB` : "hidden", mem ? bits(MEMORY[mem] || 0.1) : 0);

    const renderer = gpu();
    if (renderer) {
      const hit = GPU.find(([re]) => re.test(renderer));
      add("gpu", "Graphics card", renderer.replace(/^ANGLE \(|\)$/g, "").slice(0, 60), bits(hit ? hit[1] : 0.02) + 1.5, { estimated: true });
    } else {
      add("gpu", "Graphics card", "hidden", 0, { protected: true });
    }

    const canvas = canvasHash();
    if (canvas.randomised) add("canvas", "Canvas fingerprint", "randomised by your browser", 0, { protected: true });
    else add("canvas", "Canvas fingerprint", canvas.hash, 8, { estimated: true });

    const f = fonts();
    add("fonts", "Installed fonts", `${f} of ${FONT_TEST.length} test fonts`, 3 + (f > 20 || f < 8 ? 2 : 0), { estimated: true });

    // Signals are not independent (a MacBook implies certain screens and graphics), so discount the sum
    const total = Math.min(33, out.reduce((a, s) => a + s.bits, 0) * 0.8);
    const lookalikes = 5e9 / Math.pow(2, total);
    const band =
      lookalikes > 1e5 ? { key: "crowd", level: 0, label: "Blends into a crowd", text: "Many thousands of browsers look like yours." }
      : lookalikes > 1e3 ? { key: "some", level: 1, label: "Fairly distinctive", text: "Perhaps thousands of browsers look like yours." }
      : lookalikes > 10 ? { key: "very", level: 2, label: "Very distinctive", text: "Perhaps only a few hundred browsers look like yours." }
      : { key: "unique", level: 3, label: "Probably unique", text: "Few or no other browsers look like yours, so you can be recognised without cookies." };

    const readable = out.filter((s) => s.value !== "hidden" && s.tier !== "protected").length;
    const rare = out.filter((s) => s.tier === "rare").length;
    const protectedCount = out.filter((s) => s.tier === "protected").length;
    const tips = [];
    if (band.level >= 2) tips.push("Firefox and Brave blunt several of these signals by default, which makes you look more like everyone else.");
    if (!canvas.randomised) tips.push("Your canvas fingerprint is not randomised. A privacy extension or browser can scramble it.");
    tips.push("Fingerprinting works without cookies, so deleting cookies does not remove it.");
    return { signals: out.sort((a, b) => b.bits - a.bits), bits: total, band, readable, rare, protectedCount, tips };
  }

  return { measure };
})();
