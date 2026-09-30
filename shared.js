// Helpers shared by the popup and the block page.
const Reef = (() => {
  const STAGES = 5;

  // progress 0..1 -> growth stage 0..4
  function stageFor(progress) {
    return Math.max(0, Math.min(STAGES - 1, Math.floor(progress * STAGES)));
  }

  // "https://www.YouTube.com/watch?v=1" -> "youtube.com", or null if invalid
  function normalizeDomain(input) {
    let text = String(input || "").trim().toLowerCase();
    if (!text) return null;
    if (!text.includes("://")) text = "https://" + text;
    let host;
    try {
      host = new URL(text).hostname;
    } catch {
      return null;
    }
    host = host.replace(/^www\./, "");
    return /^([a-z0-9-]+\.)+[a-z0-9-]{2,}$/.test(host) ? host : null;
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  // Branches appear as the coral grows: [first stage, path, stroke width]
  const BRANCHES = [
    [1, "M50 88 L50 72", 7],
    [2, "M50 72 L50 58", 7],
    [2, "M50 80 L36 66", 6],
    [2, "M50 78 L64 64", 6],
    [3, "M36 66 L30 50", 5],
    [3, "M64 64 L70 48", 5],
    [3, "M50 58 L44 44", 5],
    [4, "M50 58 L57 42", 5],
    [4, "M30 50 L24 40", 4],
    [4, "M70 48 L76 38", 4],
    [4, "M44 44 L40 32", 4],
  ];
  const TIPS = [[24, 40], [76, 38], [40, 32], [57, 42]];

  // Returns an SVG string. Only numbers are interpolated, so it is safe for innerHTML.
  function coralSVG({ stage = 4, bleached = false, hue = 12 } = {}) {
    const h = Number(hue) | 0;
    const color = bleached ? "hsl(40,18%,86%)" : `hsl(${h},78%,62%)`;
    const shade = bleached ? "hsl(40,10%,72%)" : `hsl(${h},70%,48%)`;
    let body = "";
    if (stage === 0) {
      body += `<circle cx="50" cy="85" r="4.5" fill="${color}" stroke="${shade}" stroke-width="1.5"/>`;
    }
    for (const [from, d, w] of BRANCHES) {
      if (stage >= from) {
        body += `<path d="${d}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;
      }
    }
    if (stage >= 4) {
      for (const [x, y] of TIPS) {
        body += `<circle cx="${x}" cy="${y}" r="3.6" fill="${shade}"/>`;
      }
    }
    return (
      `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Coral">` +
      body +
      `</svg>`
    );
  }

  return { STAGES, stageFor, normalizeDomain, formatTime, coralSVG };
})();
