# PM-doc: Reef (working title)

## 1. What are we building

A Chrome extension (Manifest V3) that helps the user stay focused by blocking distracting websites during a timed focus session. While the user focuses, a coral grows. If they give up early, the coral bleaches and dies. Finished corals are collected in a personal reef.

It is also a lightweight productivity app: a to-do list that can detect when you did a task (e.g. sent an email in Gmail) and ask you to confirm it.

**Target user:** anyone who loses time to YouTube, social media, etc. and wants a gentle but firm nudge, plus a simple way to track what they get done.

**Out of scope for V1:** accounts/sync across devices, sounds, custom coral types, scheduling, password-protected blocklist, auto-detection outside Gmail.

## 2. Features and acceptance criteria

### F1: Blocklist
The user manages a list of sites to block.

- [ ] The extension popup has a text field to add a domain (e.g. `youtube.com`).
- [ ] Added domains appear in a list and each has a remove button.
- [ ] Input is normalized: `https://www.youtube.com/watch?v=1` is stored as `youtube.com`.
- [ ] Adding an empty or invalid value shows an error and does not save.
- [ ] Duplicate domains are not added twice.
- [ ] The list is still there after closing and reopening Chrome.
- [ ] Subdomains are covered (blocking `youtube.com` also blocks `m.youtube.com`).
- [ ] Sites cannot be removed from the list while a focus session is running (otherwise the block could be bypassed).

### F2: Focus session timer
Blocking is only active during a session.

- [ ] The popup has a duration selector (15 / 25 / 45 / 60 min) and a "Start focus" button.
- [ ] After starting, the popup shows the remaining time counting down.
- [ ] The timer keeps running when the popup is closed.
- [ ] The timer survives the browser being idle (state is stored by end time, not a running counter).
- [ ] Blocklisted sites are blocked only while a session is active.
- [ ] When the timer reaches 0, the session ends as "completed" and blocking stops.
- [ ] Only one session can run at a time.

### F3: Block page
What the user sees instead of a blocked site.

- [ ] Opening a blocked site during a session shows the extension's own page instead.
- [ ] The page shows the blocked domain, the remaining time, and the growing coral.
- [ ] The page has no button that unblocks the site without ending the session.
- [ ] Sites not on the blocklist load normally.
- [ ] Outside a session, blocklisted sites load normally.

### F4: Coral reward (grow / bleach)
The Forest-style incentive.

- [ ] During a session the coral visibly progresses through at least 4 growth stages, based on elapsed time.
- [ ] The coral is shown in the popup and on the block page.
- [ ] Completed session: a finished coral is added to the reef.
- [ ] "Give up" button in the popup ends the session early after a confirmation ("Your coral will bleach").
- [ ] Given-up session: blocking stops, the coral is shown as bleached, and it is **not** added to the reef (it is logged as failed).
- [ ] The reef view shows all collected corals (one per completed session).

### F5: Stats
- [ ] The popup shows: sessions completed today, sessions given up today, total focus minutes today.
- [ ] Stats are still there after restarting Chrome.
- [ ] Stats reset for the new day (today's numbers only count today), while the reef keeps all corals.

### F6: To-do list
Makes Reef a productivity app, not only a blocker.

- [ ] The popup has a to-do list: add a to-do with a title, mark it done, delete it.
- [ ] Each to-do has an optional tag: "None" or "Send email".
- [ ] Completed to-dos move to a "done" section and count in today's stats (F5).
- [ ] To-dos are still there after restarting Chrome.
- [ ] Empty titles are not accepted.

### F7: Auto-detect completion (Gmail)
The extension notices when you did the work and asks you to confirm.

- [ ] When an email is sent in Gmail (`mail.google.com`), the extension detects it.
- [ ] If at least one open to-do is tagged "Send email", a pop-up asks: "You just sent an email. Did you complete one of these?" and lists those to-dos.
- [ ] The user can tick a to-do (marks it done) or dismiss the pop-up (nothing changes).
- [ ] If no open to-do is tagged "Send email", no pop-up appears.
- [ ] Nothing is ever marked done without the user confirming.
- [ ] Privacy: only the fact that an email was sent is detected. Subject, recipients and body are never read or stored.
- [ ] Detection relies on Gmail's English "Message sent" confirmation, so V1 works with the English Gmail interface only.
- [ ] Only Gmail is supported in V1. Other sites and mail clients are out of scope.

### F8: New tab page
Reef is the first thing you see in every new tab.

- [ ] Opening a new tab shows the Reef page full screen (ocean background) instead of Chrome's default new tab.
- [ ] It shows the clock, the current coral, the focus timer with a duration choice (15/25/45/60) and Start button.
- [ ] Give up works the same as in the popup (confirmation, then the coral bleaches).
- [ ] Today's stats and the to-do list (add, complete, delete, tag) are on the page and stay in sync with the popup.
- [ ] The reef along the seabed shows the corals collected from completed sessions.
- [ ] While a session is running, the timer and coral keep updating without reloading the tab.
- [ ] Managing blocked sites stays in the popup (Sites tab).

## 3. Technical notes (for the build)

- Manifest V3, plain HTML/CSS/JS, no build step.
- Blocking via `declarativeNetRequest` dynamic rules (redirect to `blocked.html`), added on session start and removed on session end/give-up.
- Storage: `chrome.storage.local` (blocklist, active session `{startTime, endTime}`, history).
- Session end handled by `chrome.alarms` in the background service worker.
- Gmail detection: content script on `mail.google.com` that watches for the Send action / "Message sent" confirmation and messages the background worker (`chrome.runtime.sendMessage`). Detection depends on Gmail's page structure and may need updating if Gmail changes.
- Files: `manifest.json`, `background.js`, `popup.html/js/css`, `blocked.html/js/css`, `gmail-content.js`.
- Coral drawn with inline SVG or emoji stages; no external assets required.

## 4. Definition of done for V1

All checkboxes above pass in a manual test, and the extension loads in Chrome via `chrome://extensions` -> Developer mode -> Load unpacked without errors.
