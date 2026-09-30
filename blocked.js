const $ = (sel) => document.querySelector(sel);

const site = Reef.normalizeDomain(new URLSearchParams(location.search).get("site")) || "this site";
let session = null;
let coralKey = "";
let finished = false;

function setCoral(opts) {
  const key = JSON.stringify(opts);
  if (key === coralKey) return;
  coralKey = key;
  $("#coral").innerHTML = Reef.coralSVG(opts);
}

function showFinished() {
  finished = true;
  $("#title").textContent = "Focus session over";
  $("#message").textContent = `${site} is available again.`;
  $("#timer").hidden = true;
  setCoral({ stage: 4, hue: 12 });
  if (site !== "this site") {
    const link = $("#continue");
    link.href = "https://" + site;
    link.textContent = "Continue to " + site;
    link.hidden = false;
  }
}

function update() {
  if (finished) return;
  if (!session || session.endTime <= Date.now()) {
    showFinished();
    if (session) chrome.runtime.sendMessage({ type: "check" });
    return;
  }
  const remaining = session.endTime - Date.now();
  const progress = (Date.now() - session.startTime) / (session.endTime - session.startTime);
  $("#title").textContent = "Stay focused";
  $("#message").textContent = `${site} is blocked while your coral grows.`;
  $("#timer").hidden = false;
  $("#timer").textContent = Reef.formatTime(remaining);
  setCoral({ stage: Reef.stageFor(progress), hue: 12 });
}

chrome.storage.local.get("session").then((res) => {
  session = res.session || null;
  update();
  setInterval(update, 1000);
});

// If the session is given up or ended elsewhere, unblock the page right away.
chrome.storage.onChanged.addListener((changes) => {
  if (changes.session) {
    session = changes.session.newValue || null;
    update();
  }
});
