// Draws the shareable "digital twin" image on a canvas (1200x630). Everything stays local.
const ShareCard = (() => {
  const W = 1200;
  const H = 630;
  const SERIF = 'Georgia, "Iowan Old Style", "Palatino Linotype", serif';
  const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function fit(g, text, maxWidth) {
    if (g.measureText(text).width <= maxWidth) return text;
    while (text.length > 1 && g.measureText(text + "…").width > maxWidth) text = text.slice(0, -1);
    return text + "…";
  }

  // avatarImg: an Image (screenshot of the 3D scene) or null. rows: [{ label, value, conf }]
  function draw(canvas, { avatarImg, rows, completeness }) {
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext("2d");

    g.fillStyle = "#040b1d";
    g.fillRect(0, 0, W, H);
    // faint grid floor along the bottom, like the 3D scene
    g.strokeStyle = "rgba(47,107,255,0.28)";
    g.lineWidth = 1;
    for (let i = -10; i <= 10; i++) {
      g.beginPath();
      g.moveTo(W / 2 + i * 30, H - 150);
      g.lineTo(W / 2 + i * 150, H);
      g.stroke();
    }
    for (let j = 0; j < 5; j++) {
      const y = H - 150 + j * j * 9 + j * 6;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }

    // avatar panel
    g.save();
    roundRect(g, 40, 40, 400, 550, 18);
    g.clip();
    g.fillStyle = "#050f26";
    g.fillRect(40, 40, 400, 550);
    if (avatarImg && avatarImg.width) {
      const s = Math.min(400 / avatarImg.width, 550 / avatarImg.height);
      const w = avatarImg.width * s;
      const h = avatarImg.height * s;
      g.drawImage(avatarImg, 40 + (400 - w) / 2, 40 + (550 - h) / 2, w, h);
    }
    g.restore();
    g.strokeStyle = "#24587f";
    g.lineWidth = 2;
    roundRect(g, 40, 40, 400, 550, 18);
    g.stroke();

    // title
    g.fillStyle = "#eaf6f8";
    g.font = `400 46px ${SERIF}`;
    g.fillText("My digital twin", 490, 98);
    g.fillStyle = "#8fb8cc";
    g.font = `italic 400 22px ${SERIF}`;
    g.fillText("What websites could guess about me", 490, 132);

    // completeness chip
    const chip = `${Math.round((completeness || 0) * 100)}% complete`;
    g.font = `600 15px ${SANS}`;
    const cw = g.measureText(chip).width + 28;
    g.fillStyle = "rgba(127,224,212,0.16)";
    roundRect(g, W - 40 - cw, 62, cw, 32, 16);
    g.fill();
    g.fillStyle = "#7fe0d4";
    g.fillText(chip, W - 40 - cw + 14, 83);

    // guesses
    let y = 190;
    const shown = rows.slice(0, 6);
    if (!shown.length) {
      g.fillStyle = "#8fb8cc";
      g.font = `italic 400 24px ${SERIF}`;
      g.fillText("Nothing to show yet. Browse a little and try again.", 490, y + 20);
    }
    for (const r of shown) {
      g.fillStyle = "#8fb8cc";
      g.font = `600 13px ${SANS}`;
      g.fillText(r.label.toUpperCase(), 490, y);
      g.fillStyle = "#eaf6f8";
      g.font = `400 28px ${SERIF}`;
      g.fillText(fit(g, r.value, 440), 490, y + 32);
      // confidence
      g.fillStyle = "rgba(255,255,255,0.14)";
      roundRect(g, 960, y + 14, 170, 8, 4);
      g.fill();
      g.fillStyle = "#7fe0d4";
      roundRect(g, 960, y + 14, Math.max(8, 170 * r.conf), 8, 4);
      g.fill();
      g.fillStyle = "#8fb8cc";
      g.font = `400 14px ${SANS}`;
      g.fillText(`${Math.round(r.conf * 100)}% sure`, 1050, y + 42);
      y += 66;
    }

    // footer
    g.fillStyle = "#8fb8cc";
    g.font = `400 16px ${SANS}`;
    g.fillText("Made with Reef · crude guesses from simple rules, often wrong", 490, H - 34);
    g.fillStyle = "#ff7a6b";
    g.font = `600 18px ${SANS}`;
    g.textAlign = "right";
    g.fillText("reef", W - 40, H - 34);
    g.textAlign = "left";
  }

  // Example data for demos, so the user does not have to show their real browsing
  const SAMPLE_SIGNALS = {
    pages: 80,
    cats: { gaming: 10, dev: 14, tech: 6, shopping: 15, fashion: 10, music: 9, travel: 4, video: 6 },
    hours: [3, 4, 2, 0, 0, 0, 0, 1, 2, 3, 3, 3, 2, 3, 3, 3, 3, 4, 5, 6, 6, 7, 8, 8],
    days: [5, 9, 10, 8, 9, 12, 9],
    domains: { "nike.com": { n: 6 }, "adidas.com": { n: 3 }, "zalando.de": { n: 4 }, "temu.com": { n: 5 }, "github.com": { n: 12 }, "tiktok.com": { n: 8 }, "twitch.tv": { n: 5 }, "spotify.com": { n: 9 } },
    gender: { m: 0, f: 0, sites: {} },
  };

  return { draw, SAMPLE_SIGNALS };
})();
