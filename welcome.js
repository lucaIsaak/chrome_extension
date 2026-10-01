const $ = (sel) => document.querySelector(sel);

async function choose(recording) {
  const { settings = {} } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({
    settings: { ...settings, tracking: recording, welcomed: true, retentionDays: Number($("#retention").value) },
  });
  $("#choice").hidden = true;
  $("#done").hidden = false;
  $("#done-title").textContent = recording ? "Recording is on" : "Recording stays off";
  $("#done-text").textContent = recording
    ? "Browse as usual. After a few pages, open your shadow to see who is watching and what they could guess about you. You can pause or delete everything there at any time."
    : "Reef will only run the focus tools. You can switch recording on later from the your shadow page.";
}

$("#start").addEventListener("click", () => choose(true));
$("#later").addEventListener("click", () => choose(false));
