// Runs on mail.google.com. Detects that an email was sent (the "Message sent" toast)
// and asks the user whether an open "Send email" to-do is now complete.
// Only the fact that a send happened is used. Subject, recipients and body are never read.
(() => {
  if (window.top !== window) return;

  let toastVisible = false;
  let scheduled = null;

  const sentToastPresent = () =>
    [...document.querySelectorAll('[role="alert"]')].some((el) => /^\s*message sent/i.test(el.textContent || ""));

  function check() {
    scheduled = null;
    const visible = sentToastPresent();
    if (visible && !toastVisible) onEmailSent();
    toastVisible = visible;
  }

  // Throttle: Gmail mutates the DOM constantly.
  new MutationObserver(() => {
    if (!scheduled) scheduled = setTimeout(check, 300);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  async function onEmailSent() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "emailSent" });
      if (res && res.todos && res.todos.length) showPrompt(res.todos);
    } catch {
      // Extension was reloaded or updated; nothing to do.
    }
  }

  function showPrompt(todos) {
    document.getElementById("reef-prompt")?.remove();
    const host = document.createElement("div");
    host.id = "reef-prompt";
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;";
    const root = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      .box { width: 300px; padding: 14px; border-radius: 12px; background: #fff; color: #10343b;
             box-shadow: 0 6px 24px rgba(0,0,0,.25); font: 14px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif; }
      h3 { margin: 0 0 6px; font-size: 15px; color: #0f766e; }
      p { margin: 0 0 10px; }
      label { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
      .row { display: flex; gap: 8px; margin-top: 10px; }
      button { flex: 1; padding: 8px; border-radius: 8px; border: 1px solid #0f766e; font: inherit; font-weight: 600; cursor: pointer; }
      .yes { background: #0f766e; color: #fff; }
      .no { background: #fff; color: #0f766e; }
    `;

    const box = document.createElement("div");
    box.className = "box";
    const title = document.createElement("h3");
    title.textContent = "Reef";
    const text = document.createElement("p");
    text.textContent = "You just sent an email. Did you complete a to-do?";
    box.append(title, text);

    const checks = [];
    for (const t of todos) {
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = todos.length === 1;
      const span = document.createElement("span");
      span.textContent = t.title;
      label.append(cb, span);
      box.append(label);
      checks.push([t.id, cb]);
    }

    const row = document.createElement("div");
    row.className = "row";
    const yes = document.createElement("button");
    yes.className = "yes";
    yes.textContent = "Mark done";
    yes.addEventListener("click", async () => {
      const ids = checks.filter(([, cb]) => cb.checked).map(([id]) => id);
      if (ids.length) {
        try {
          await chrome.runtime.sendMessage({ type: "completeTodos", ids });
        } catch {}
      }
      host.remove();
    });
    const no = document.createElement("button");
    no.className = "no";
    no.textContent = "Dismiss";
    no.addEventListener("click", () => host.remove());
    row.append(yes, no);
    box.append(row);

    root.append(style, box);
    document.body.append(host);
  }
})();
