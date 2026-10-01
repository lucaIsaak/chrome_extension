// Runs in every page (isolated world). Forwards what page-hooks.js saw to the extension,
// and sends the page title and description once so they can be classified locally.
(() => {
  window.addEventListener("__reef_fp", (e) => {
    try {
      const items = JSON.parse(e.detail);
      if (Array.isArray(items) && items.length) chrome.runtime.sendMessage({ type: "fp", items }).catch(() => {});
    } catch {}
  });

  if (window.top !== window) return;

  let lastHref = "";
  const sendPage = () => {
    try {
      if (location.href === lastHref) return;
      lastHref = location.href;
      const meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
      chrome.runtime
        .sendMessage({
          type: "page",
          title: (document.title || "").slice(0, 200),
          desc: ((meta && meta.content) || "").slice(0, 300),
          path: location.pathname.slice(0, 300), // never the query string
        })
        .catch(() => {});
    } catch {}
  };

  if (document.readyState === "complete") setTimeout(sendPage, 500);
  else window.addEventListener("load", () => setTimeout(sendPage, 500));
  // Single-page sites change the address without reloading, so look again now and then
  setInterval(() => {
    if (location.href !== lastHref) setTimeout(sendPage, 800);
  }, 1500);
})();
