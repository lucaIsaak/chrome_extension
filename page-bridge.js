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

  const sendPage = () => {
    try {
      const meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
      chrome.runtime
        .sendMessage({
          type: "page",
          title: (document.title || "").slice(0, 200),
          desc: ((meta && meta.content) || "").slice(0, 300),
        })
        .catch(() => {});
    } catch {}
  };

  if (document.readyState === "complete") setTimeout(sendPage, 500);
  else window.addEventListener("load", () => setTimeout(sendPage, 500));
})();
