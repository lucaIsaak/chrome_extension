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

- [ ] Opening a new tab shows the Reef page full screen instead of Chrome's default new tab.
- [ ] It shows the date, a time-of-day greeting, a large clock and a short quote on the left.
- [ ] A Focus card shows the coral, the duration choice (15/25/45/60) and the Start button. While a session runs it shows the countdown and a Give up button.
- [ ] Give up works the same as in the popup (confirmation, then the coral bleaches).
- [ ] A "Your list" card lets the user add, complete and delete to-dos and tag them "Send email". It stays in sync with the popup.
- [ ] The footer shows today's stats and the corals collected from completed sessions.
- [ ] While a session is running, the timer and coral keep updating without reloading the tab.
- [ ] "Choose a scene" lets the user pick one of three built-in backgrounds (Dusk, Deep sea, Sunset) or upload their own image.
- [ ] An image can also be dragged and dropped onto the page to become the background.
- [ ] The chosen scene is still there after restarting Chrome, and the reset button restores the default.
- [ ] The Focus card has a "Blocked while you focus" section: add a site, see all blocked sites as chips, remove one with ×. It is hidden while a session runs. The popup's Sites tab shows the same list.
- [ ] The header has two switchers on the left, "reef" and "your shadow". The page the user is on is highlighted. Both pages (new tab and Shadow) use the same header.

## 2b. Second purpose: "Shadow" (V2)

Reef also shows **what websites collect about you** and what they could **infer** from it. Everything is observed and stored locally in the browser, nothing is sent anywhere.

**Out of scope:** political views, sexual orientation, health conditions and religion are never inferred. Sites that look like adult, dating, medical or political-party sites are never recorded at all. What a website does with data on its own servers cannot be observed, so the extension only shows what leaves the browser and what is exposed.

### F9: Footprint (data collected per website)
- [ ] For every website visited, the extension records the third parties contacted (domain, company if known, category such as advertising, analytics, social, session replay, data broker, and number of requests).
- [ ] It records cookies set by the site and by third parties (name, domain, lifetime in days, third-party yes/no). Cookie values are not stored.
- [ ] It records identifiers and data sent to third parties in URLs and request bodies (parameter name, kind such as identifier / device / location / page / campaign, and a shortened sample value).
- [ ] It detects fingerprinting and device-reading behaviour in the page (canvas read-back, graphics card query, audio rendering, font probing, CPU/memory, screen, time zone, language, plugins, geolocation request, background beacons) and shows which script host did it.
- [ ] Each website gets an exposure score (Low / Medium / High / Very high) with a short reason.
- [ ] A "Shadow" page lists all websites sorted by exposure. Opening a website shows the details above.
- [ ] A summary shows how many websites, trackers and companies were found, and which companies follow the user across the most websites.
- [ ] Every website row has a "Raw data | Decoded" switch to the left of the tracker count. Raw data shows the technical details. Decoded explains the same data in plain words: who was watching and what each company does, what they could learn, whether they can follow the user to other sites, and what the user can do. Decoded is the default and the choice is remembered. The summary tiles and exposure labels also switch to plain wording.
- [ ] A panel shows what the browser exposes to every website without asking (system, language, time zone, screen, CPU cores, and that the IP address reveals an approximate location).
- [ ] The user can pause tracking and delete all collected data at any time.

### F10: Digital twin (what could be inferred about you)
- [ ] The Shadow page has a left sidebar that works as the main navigation: an "Explore" list (Digital twin, Footprint) and a "Style" list. The current entry is highlighted.
- [ ] Clicking "your shadow" opens the Digital twin view first.
- [ ] The twin is shown as a 3D scene: a glowing grid floor under a starry sky, with the avatar (or the question mark) floating above it.
- [ ] The user can rotate the scene by dragging with the mouse or two-finger scrolling on the trackpad. Pinch zooms, double-click resets, arrow keys also rotate.
- [ ] If WebGL is not available, a flat 2D avatar is shown instead.
- [ ] A "Style" list in the left sidebar of the Shadow page (each entry with a small preview) lets the user choose between three themes: Glass (default), HUD (neon outlines, corner brackets, mono labels) and Terminal (monospace log lines, scanlines, radar sweep). The 3D scene changes colours with the theme.
- [ ] The chosen theme is remembered after closing the browser.
- [ ] The twin starts as a floating question mark and a "0% complete" status.
- [ ] As more pages are visited, attributes appear, each with a value, a confidence bar and the evidence ("Because you visited ...").
- [ ] Attributes: location (time zone / language), languages, device, daily rhythm, interests, work or life stage, spending behaviour, clothing style, age range (guess), gender lean (guess).
- [ ] Hair colour always stays "?" with the explanation that nothing in the data reveals it.
- [ ] The gender guess also reads shop sections in the page address and title in several languages (for example /men/, /homem/, Damenmode). Only counts are stored, never the address. Browsing a men's or women's section is enough to produce a low-confidence guess, with the pages as evidence.
- [ ] Age and gender guesses are capped at low confidence and labelled as unreliable ad-tech style guesses.
- [ ] The avatar visibly fills in as confidence grows (outfit style, props that match interests) and shows a completeness percentage.
- [ ] Only counters are stored (categories, hours, domain counts). Page titles and text are classified locally and then discarded.
- [ ] A note on the page states which traits are never inferred.

### F11: Trust and housekeeping
- [ ] Reef has a toolbar icon (the coral) at 16, 32, 48 and 128 pixels.
- [ ] After installing, a welcome page opens. It explains what Reef records and never does. Recording stays off until the user presses "Start recording". "Not now" keeps the focus tools only. The same page lets the user choose how long data is kept.
- [ ] Without that agreement nothing is recorded, and the Shadow page says so with a link to the welcome page. Switching the Recording toggle on before agreeing opens the welcome page.
- [ ] When a focus session ends while the user is elsewhere, a desktop notification says so. Giving up and opening the popup after the fact do not notify.
- [ ] Retention: the user can keep data for 30 days, 90 days, 1 year or forever. Older sites and daily signal buckets are deleted automatically once a day, and when the setting changes. The digital twin is rebuilt from what remains.
- [ ] Each website has "Export this site" and "Delete this site" (with confirmation). Delete removes the record, its visits and its audience signals. There is also "Export all data" (a JSON file) and "Delete all data".
- [ ] Private (incognito) windows are never recorded, even if the extension is allowed there. The Shadow page says so.
- [ ] A privacy policy page (privacy.html) and PRIVACY.md describe what is stored, what never is, why each permission is needed, and the user's controls. It is linked from the welcome page and the Shadow sidebar.

### F12: Act on what you learn (V2.2)
- [ ] **Block this tracker:** next to every tracking company (and unknown third-party domain) in Footprint, in both Raw and Decoded views and in "Who follows you", there is a Block button. Blocking a company blocks all its tracking domains, only when loaded by another site, never the site itself. A "Blocked trackers" card lists everything blocked with Undo and "Unblock everything". Infrastructure such as CDNs and tag managers cannot be blocked. Focus-mode rules and tracker rules never delete each other.
- [ ] **Blocked requests are counted** per day and per site, so the report can say how many were stopped.
- [ ] **"Is this you?" feedback:** every twin guess has Right and Wrong buttons. A wrong guess is struck through, the avatar drops the matching detail (outfit, props), and the stage shows "you rated N guesses: M wrong". Answers fade after 30 days.
- [ ] **Weekly privacy report** at the top of Footprint: companies that watched the user this week, change versus the previous week, worst site, top watcher and requests stopped by Reef. It says "first week" until there are two weeks of data.
- [ ] **Top-right tools on the 3D stage:** the "Share my twin" button (with a share icon) and, to its right, a round info icon. The rotate/zoom/reset instructions are hidden and appear in a tooltip when the user hovers or focuses the info icon.
- [ ] **Shareable twin card:** a "Share my twin" button on the 3D stage opens a preview of a 1200x630 image (avatar plus guesses). Location, device and languages are unticked by default. An example-data switch avoids showing real browsing. Download PNG or Copy image. Nothing is uploaded.
- [ ] **Focus and privacy:** blocked-site chips on the new tab show how many tracking companies usually watch the user there. The Focus session summary says how many visits Reef turned away and how many companies that avoided. A "Your distracting sites" card in Footprint shows the same per site.
- [ ] **Reef health (0-100)** is computed from companies met this week and the share of tracking blocked. Low health makes the new tab water murkier and the reef corals duller, and the new tab shows "water clarity". Bleaching still only means a given-up session.
- [ ] The Digital twin details sit in one container with two tabs, each with an icon: "Guesses" (person-search icon: known facts and learned guesses) and "Fingerprint" (fingerprint icon: the uniqueness test). Guesses is shown first.
- [ ] **Fingerprint test:** a card at the top of the Digital twin list shows a band (blends into a crowd / fairly distinctive / very distinctive / probably unique), how many signals any site can read, how many are rare and how many are protected, plus tips. It is labelled a rough estimate from bundled typical values, with no exact number.

### F13: Avatar network (demo, V2.3)
Learn how to protect yourself from others' recipes, not from their data. The network is simulated (about 1,000 anonymous avatars and a friends circle) so everything works with no server and nothing leaves the device. A real network would replace only the data source in network.js, and the privacy policy would change first.
- [ ] A "Network" entry in the Shadow sidebar opens a page with a banner saying the people shown are simulated.
- [ ] The user's privacy score (0 = worst, 100 = best) is the reef-health score from the weekly report.
- [ ] The user can join the **global network** and the **friends network** independently. Both are off by default. Joining is how the user sees that ranking.
- [ ] Rankings are private. The user only sees their own position ("top 16% globally", "2nd of 7 among friends"). No list of other people is ever shown.
- [ ] Others only ever see an anonymous name (for example Kelp-25), the score, the trackers blocked and the habits ticked. Never sites, browsing or the twin. Two toggles let the user hide the blocklist or the habits. A line shows exactly what others would see.
- [ ] **In the 3D scene:** the top-left of the Digital twin stage is a switch, "Your digital twin | Your network", with the selected side highlighted. "Your network" shows the user in the middle of the glowing grid with friends around and their friends behind, each a small avatar with a name and score label, coloured coral (low) to aqua (high). The camera fits everyone in view. Avatars can be clicked (not dragged) to select them: a ring marks the selection and a card shows the score, how many companies they block, **Adopt blocklist** and **Full recipe**. If the user has not joined the friends network, the card offers to join. Share my twin is hidden in this view.
- [ ] **Deselect:** in the 3D network the selected avatar can be deselected with a "Deselect" button on its card, by clicking it again, or with Esc. The flat graph and recipe panel follow.
- [ ] **Top three glow:** the three best scores in view (the user included) have a pulsing green circle under them: strongest for first place, medium for second, faint but visible for third. The glow size is the same wherever the avatar stands, so rank rather than distance decides how strong it looks. The card text explains the glow.
- [ ] A graph shows the user in the centre, friends around them and their own friends behind, coloured from coral (low score) to aqua (high). Clicking an avatar shows its recipe.
- [ ] "Best-protected avatars" (global only) lists three anonymous top recipes.
- [ ] A recipe shows the companies blocked, the habits with a how-to tip each, and an "Adopt this blocklist" button that blocks the companies the user does not block yet. Adopting can be undone under Blocked trackers.
- [ ] The user ticks their own habits (tracker blocker extension, privacy browser, third-party cookie blocking, rejecting cookie banners, private search, VPN), because Reef cannot see other extensions.

### F14: Toolkit (V2.4)
One page for everything the user does to protect themselves from tracking. The sidebar order is Digital twin, Network, Toolkit, Footprint.
- [ ] **Summary tiles:** privacy score, habits ticked (for example "5 of 9"), trackers blocked, and requests stopped this week.
- [ ] **Active protections:** what Reef measures itself: tracker blocking (with a link to manage it), focus-mode sites (link to the new tab), recording on or paused, private windows and sensitive sites never recorded, and the retention period.
- [ ] **Your habits:** the checklist of privacy habits (tracker blocker extensions, privacy browser, third-party cookie blocking, rejecting cookie banners, private search, VPN) with a progress bar and a how-to tip under every unticked habit. It lives here and no longer on the Network page. Reef cannot see other extensions or browser settings, so these are self-declared. What is ticked is also what others see if the user joins a network.
- [ ] **Suggested next steps:** personalised from the data: the top watching companies that are not blocked yet (with a Block button), no blocker or privacy browser ticked, a very distinctive browser, cookie and banner tips, joining a network, and adding focus sites. At most six, and they disappear once done.
- [ ] **What moves your score:** shows the score as a starting point of 80, minus points for companies met, plus points for the share of tracking blocked, so the numbers add up.
- [ ] **Your recipe:** the shareable part (what others would see) with a link to the sharing settings on the Network page.
## 3. Technical notes (for the build)

- Manifest V3, plain HTML/CSS/JS, no build step.
- Shadow: `webRequest` (observe only) for requests, `Set-Cookie` headers and request bodies; a MAIN-world content script (`page-hooks.js`) wraps fingerprinting-related browser APIs; an isolated content script (`page-bridge.js`) forwards the results and the page title to the service worker. Tracker list in `trackers.js`, categories in `categories.js`, inference in `twin.js`, UI in `insights.html/js/css`.
- Blocking via `declarativeNetRequest` dynamic rules (redirect to `blocked.html`), added on session start and removed on session end/give-up.
- Storage: `chrome.storage.local` (blocklist, active session `{startTime, endTime}`, history).
- Session end handled by `chrome.alarms` in the background service worker.
- Gmail detection: content script on `mail.google.com` that watches for the Send action / "Message sent" confirmation and messages the background worker (`chrome.runtime.sendMessage`). Detection depends on Gmail's page structure and may need updating if Gmail changes.
- Files: `manifest.json`, `background.js`, `popup.html/js/css`, `blocked.html/js/css`, `gmail-content.js`.
- Coral drawn with inline SVG or emoji stages; no external assets required.

## 4. Definition of done for V1

All checkboxes above pass in a manual test, and the extension loads in Chrome via `chrome://extensions` -> Developer mode -> Load unpacked without errors.
