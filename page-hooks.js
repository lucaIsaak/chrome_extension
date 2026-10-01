// Runs inside every page (MAIN world). Watches browser APIs that are commonly used to
// fingerprint or profile visitors and reports which script host used them. It only counts
// calls: it never changes results and never reads values.
(() => {
  if (window.__reefHooked) return;
  window.__reefHooked = true;

  const counts = new Map();
  let timer = null;

  // The first http(s) URL in the stack is the script that made the call.
  function scriptHost() {
    try {
      for (const line of (new Error().stack || "").split("\n")) {
        const m = line.match(/https?:\/\/([^/:\s)]+)/);
        if (m) return m[1];
      }
    } catch {}
    return location.hostname;
  }

  function flush() {
    timer = null;
    const items = [...counts].map(([key, n]) => {
      const i = key.indexOf("|");
      return { t: key.slice(0, i), h: key.slice(i + 1), n };
    });
    counts.clear();
    try {
      window.dispatchEvent(new CustomEvent("__reef_fp", { detail: JSON.stringify(items) }));
    } catch {}
  }

  function note(type) {
    const key = type + "|" + scriptHost();
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!timer) timer = setTimeout(flush, 1500);
  }

  function wrap(obj, name, type, filter) {
    try {
      const orig = obj && obj[name];
      if (typeof orig !== "function") return;
      obj[name] = function (...args) {
        try {
          if (!filter || filter(args)) note(type);
        } catch {}
        return orig.apply(this, args);
      };
    } catch {}
  }

  function hookGetter(proto, prop, type) {
    try {
      const desc = proto && Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc || !desc.get) return;
      Object.defineProperty(proto, prop, {
        ...desc,
        get() {
          note(type);
          return desc.get.call(this);
        },
      });
    } catch {}
  }

  // Canvas read-back (graphics fingerprint)
  wrap(window.HTMLCanvasElement && HTMLCanvasElement.prototype, "toDataURL", "canvas");
  wrap(window.HTMLCanvasElement && HTMLCanvasElement.prototype, "toBlob", "canvas");
  wrap(window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, "getImageData", "canvas");

  // Graphics card model (WebGL debug renderer / vendor)
  for (const name of ["WebGLRenderingContext", "WebGL2RenderingContext"]) {
    if (window[name]) wrap(window[name].prototype, "getParameter", "webgl", (a) => a[0] === 37445 || a[0] === 37446);
  }

  // Audio fingerprint
  wrap(window.OfflineAudioContext && OfflineAudioContext.prototype, "startRendering", "audio");

  // Font probing
  wrap(window.FontFaceSet && FontFaceSet.prototype, "check", "fonts");

  // Device and environment reads
  hookGetter(window.Navigator && Navigator.prototype, "hardwareConcurrency", "hardware");
  hookGetter(window.Navigator && Navigator.prototype, "deviceMemory", "hardware");
  hookGetter(window.Navigator && Navigator.prototype, "languages", "language");
  hookGetter(window.Navigator && Navigator.prototype, "plugins", "plugins");
  for (const prop of ["width", "height", "colorDepth"]) hookGetter(window.Screen && Screen.prototype, prop, "screen");
  wrap(window.Intl && Intl.DateTimeFormat && Intl.DateTimeFormat.prototype, "resolvedOptions", "timezone");

  // Background beacons and location requests
  wrap(window.Navigator && Navigator.prototype, "sendBeacon", "beacon");
  wrap(window.Geolocation && Geolocation.prototype, "getCurrentPosition", "geolocation");
  wrap(window.Geolocation && Geolocation.prototype, "watchPosition", "geolocation");
})();
