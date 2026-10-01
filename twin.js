// Builds the "digital twin": what an advertiser or data broker could plausibly guess about you
// from the same signals websites can observe. These are crude heuristics, often wrong, and that is
// the point. Every attribute carries a confidence and the evidence behind it.
//
// Never inferred: political views, sexual orientation, health, religion, ethnicity.
const Twin = (() => {
  const sat = (n, k) => 1 - Math.exp(-n / k);
  const pct = (x) => Math.round(x * 100);

  const LISTS = {
    bargain: ["aliexpress.com", "temu.com", "shein.com", "wish.com", "kleinanzeigen.de", "ebay.com", "ebay.de", "mydealz.de", "idealo.de", "geizhals.de", "groupon.com", "vinted.de", "vinted.com"],
    premium: ["farfetch.com", "net-a-porter.com", "mytheresa.com", "ssense.com", "hugoboss.com", "suitsupply.com"],
  };
  const STYLES = {
    sporty: { label: "Sporty", domains: ["nike.com", "adidas.com", "puma.com", "decathlon.de", "decathlon.com", "sportscheck.com", "newbalance.com", "gymshark.com", "underarmour.com"] },
    streetwear: { label: "Streetwear", domains: ["stockx.com", "goat.com", "hypebeast.com", "zumiez.com", "aboutyou.de"] },
    outdoor: { label: "Outdoor", domains: ["patagonia.com", "thenorthface.com", "columbia.com", "jack-wolfskin.com", "bergfreunde.de", "rei.com"] },
    smart: { label: "Smart / formal", domains: ["suitsupply.com", "hugoboss.com", "mrporter.com"] },
    luxury: { label: "Luxury", domains: ["farfetch.com", "net-a-porter.com", "mytheresa.com", "ssense.com"] },
    casual: { label: "Casual / fast fashion", domains: ["zara.com", "hm.com", "uniqlo.com", "primark.com", "shein.com", "asos.com", "zalando.de", "zalando.com", "vinted.de", "vinted.com"] },
  };
  const AGE_BUCKETS = ["16–24", "25–34", "35–44", "45–54", "55+"];
  const AGE_VOTES = {
    "tiktok.com": { "16–24": 3, "25–34": 1 },
    "snapchat.com": { "16–24": 3 },
    "twitch.tv": { "16–24": 2, "25–34": 2 },
    "discord.com": { "16–24": 2, "25–34": 2 },
    "roblox.com": { "16–24": 3 },
    "instagram.com": { "16–24": 1, "25–34": 2, "35–44": 1 },
    "reddit.com": { "16–24": 1, "25–34": 2 },
    "linkedin.com": { "25–34": 2, "35–44": 2, "45–54": 1 },
    "github.com": { "25–34": 2, "35–44": 1 },
    "stackoverflow.com": { "25–34": 2, "35–44": 1 },
    "facebook.com": { "25–34": 1, "35–44": 2, "45–54": 2, "55+": 1 },
    "xing.com": { "35–44": 2, "45–54": 2 },
    "kleinanzeigen.de": { "35–44": 1, "45–54": 2, "55+": 1 },
    "immobilienscout24.de": { "35–44": 2, "45–54": 1 },
    "finanzen.net": { "45–54": 1, "55+": 2 },
    "boerse.de": { "45–54": 1, "55+": 2 },
    "tagesschau.de": { "35–44": 1, "45–54": 1, "55+": 2 },
    "duolingo.com": { "16–24": 2, "25–34": 1 },
    "udemy.com": { "25–34": 2, "35–44": 1 },
    "studydrive.net": { "16–24": 3 },
    "moodle.org": { "16–24": 3 },
  };

  const PRETTY = {
    social: "Social media", video: "Video and streaming", music: "Music", gaming: "Gaming", shopping: "Online shopping",
    fashion: "Fashion", sports: "Sports", news: "News", tech: "Technology", dev: "Software development", finance: "Finance",
    crypto: "Crypto", travel: "Travel", food: "Food and cooking", fitness: "Fitness", education: "Learning", jobs: "Careers",
    entertainment: "Entertainment", beauty: "Beauty", auto: "Cars", home: "Home and DIY",
  };

  const sumDomains = (domains, list) => {
    let n = 0;
    const hits = [];
    for (const d of list) {
      const c = domains[d] ? domains[d].n : 0;
      if (c) {
        n += c;
        hits.push(`${d} ×${c}`);
      }
    }
    return { n, hits };
  };

  function osName(env) {
    const p = String(env.platform || "") + " " + String(env.ua || "");
    if (/iPhone|iPad/i.test(p)) return "iOS";
    if (/Mac/i.test(p)) return "Mac";
    if (/Win/i.test(p)) return "Windows";
    if (/Android/i.test(p)) return "Android";
    if (/Linux|X11/i.test(p)) return "Linux";
    return "Unknown system";
  }

  function regionName(lang) {
    try {
      const region = String(lang || "").split("-")[1];
      return region ? new Intl.DisplayNames(["en"], { type: "region" }).of(region.toUpperCase()) : null;
    } catch {
      return null;
    }
  }

  function infer(signals, env) {
    const sig = signals || { cats: {}, hours: Array(24).fill(0), days: Array(7).fill(0), domains: {}, pages: 0 };
    const domains = sig.domains || {};
    const cats = sig.cats || {};
    const attrs = [];
    // "exposed" attributes are readable by any site instantly; "inferred" ones are learned over time
    const EXPOSED = new Set(["location", "languages", "device"]);
    const add = (key, label, value, conf, evidence, note, caveat) =>
      attrs.push({
        key,
        label,
        group: EXPOSED.has(key) ? "exposed" : "inferred",
        value: value || null,
        conf: value ? Math.max(0, Math.min(1, conf)) : 0,
        evidence: evidence || [],
        note: note || "", // shown when there is no value yet
        caveat: caveat || "", // shown with the evidence when there is a value
      });

    // 1. Location: needs no browsing history at all
    const tz = env.tz || "";
    const city = tz.includes("/") ? tz.split("/").pop().replace(/_/g, " ") : tz;
    const country = regionName((env.langs || [])[0]);
    const tlds = {};
    let tldTotal = 0;
    for (const [d, v] of Object.entries(domains)) {
      const tld = d.split(".").pop();
      if (tld.length === 2) {
        tlds[tld] = (tlds[tld] || 0) + v.n;
        tldTotal += v.n;
      }
    }
    const topTld = Object.entries(tlds).sort((a, b) => b[1] - a[1])[0];
    const locEvidence = [];
    if (tz) locEvidence.push(`Time zone: ${tz}`);
    if (country) locEvidence.push(`Browser language region: ${country}`);
    if (topTld && tldTotal >= 5) locEvidence.push(`${pct(topTld[1] / tldTotal)}% of your visits go to .${topTld[0]} sites`);
    locEvidence.push("Your IP address also reveals an approximate location to every site");
    add("location", "Location", city ? `${city} area` : null, 0.9, locEvidence);

    // 2. Languages
    const langs = (env.langs || []).slice(0, 4);
    add("languages", "Languages", langs.join(", "), 0.95, [`Sent to every site in the Accept-Language header: ${langs.join(", ")}`]);

    // 3. Device
    const os = osName(env);
    const parts = [os];
    if (env.cores) parts.push(`${env.cores} CPU cores`);
    if (env.memory) parts.push(`${env.memory}+ GB RAM`);
    if (env.screen) parts.push(`${env.screen.w}×${env.screen.h} screen`);
    add("device", "Device", parts.join(", "), 0.9, ["Readable by any page without asking", "Together these make your browser close to unique (fingerprint)"]);

    // 4. Daily rhythm
    const hours = sig.hours || [];
    const total = hours.reduce((a, b) => a + b, 0);
    if (total >= 8) {
      const share = (hs) => hs.reduce((a, h) => a + (hours[h] || 0), 0) / total;
      const groups = [
        ["Night owl", [22, 23, 0, 1, 2, 3], "between 22:00 and 04:00"],
        ["Early bird", [5, 6, 7, 8], "between 05:00 and 09:00"],
        ["Office-hours browser", [9, 10, 11, 12, 13, 14, 15, 16, 17], "between 09:00 and 18:00"],
        ["Evening browser", [18, 19, 20, 21], "between 18:00 and 22:00"],
      ].map(([name, hs, text]) => ({ name, text, s: share(hs) }));
      groups.sort((a, b) => b.s - a.s);
      add("rhythm", "Daily rhythm", groups[0].name, Math.min(0.85, sat(total, 50)), [`${pct(groups[0].s)}% of visits ${groups[0].text}`, `Based on ${total} page visits`]);
    } else {
      add("rhythm", "Daily rhythm", null, 0, [], "Needs about 8 page visits");
    }

    // 5. Interests
    const interests = Object.entries(cats)
      .filter(([c, n]) => !Cats.NON_INTEREST.has(c) && PRETTY[c] && n >= 2)
      .sort((a, b) => b[1] - a[1]);
    const interestTotal = interests.reduce((a, [, n]) => a + n, 0);
    add(
      "interests",
      "Interests",
      interests.slice(0, 3).map(([c]) => PRETTY[c]).join(", "),
      Math.min(0.9, sat(interestTotal, 30)),
      interests.slice(0, 5).map(([c, n]) => `${PRETTY[c]}: ${n} signals`)
    );

    // 6. Work or life stage
    const stage = [
      ["Works with software or IT", (cats.dev || 0) * 1.5 + (cats.tech || 0) * 0.5, `Developer sites and topics: ${cats.dev || 0}`],
      ["Student or learner", (cats.education || 0) * 1.2, `Learning sites and topics: ${cats.education || 0}`],
      ["Career-minded or job-seeking", (cats.jobs || 0) * 1.5, `Job and career sites: ${cats.jobs || 0}`],
      ["Finance-minded", (cats.finance || 0) + (cats.crypto || 0), `Finance and crypto signals: ${(cats.finance || 0) + (cats.crypto || 0)}`],
    ].sort((a, b) => b[1] - a[1]);
    add("stage", "Work or life stage", stage[0][1] >= 4 ? stage[0][0] : null, Math.min(0.75, sat(stage[0][1], 10)), [stage[0][2]], "Needs a clear pattern");

    // 7. Spending behaviour
    const bargain = sumDomains(domains, LISTS.bargain);
    const premium = sumDomains(domains, LISTS.premium);
    const shopping = cats.shopping || 0;
    const macBonus = os === "Mac" || os === "iOS" ? 1 : 0;
    const spendEvidence = [];
    if (bargain.n) spendEvidence.push(`Bargain shops: ${bargain.hits.join(", ")}`);
    if (premium.n) spendEvidence.push(`Premium shops: ${premium.hits.join(", ")}`);
    if (macBonus) spendEvidence.push("Apple device: advertisers often treat this as a higher-spending signal");
    spendEvidence.push(`Shopping signals: ${shopping}`);
    let spend = null;
    if (shopping >= 3 || bargain.n + premium.n >= 2) {
      spend = bargain.n > premium.n + macBonus + 1 ? "Bargain-oriented shopper" : premium.n + macBonus > bargain.n + 1 ? "Premium-leaning shopper" : "Mainstream online shopper";
    }
    add("spending", "Spending behaviour", spend, Math.min(0.8, sat(shopping + bargain.n + premium.n, 14)), spendEvidence, "Needs a few shopping visits");

    // 8. Clothing style
    const styleVotes = Object.entries(STYLES)
      .map(([key, s]) => ({ key, label: s.label, ...sumDomains(domains, s.domains) }))
      .sort((a, b) => b.n - a.n);
    const topStyle = styleVotes[0];
    add(
      "style",
      "Clothing style",
      topStyle.n >= 3 ? topStyle.label : null,
      Math.min(0.7, sat(topStyle.n, 8)),
      topStyle.n ? [`${topStyle.hits.join(", ")}`] : [],
      "Needs visits to clothing shops"
    );

    // 9. Age range (guess)
    const ageVotes = Object.fromEntries(AGE_BUCKETS.map((b) => [b, 0]));
    const ageEvidence = [];
    for (const [d, v] of Object.entries(domains)) {
      const w = AGE_VOTES[d];
      const edu = /(^uni-|^tu-|^hs-|\.edu$|\.ac\.uk$)/.test(d);
      const votes = w || (edu ? { "16–24": 3, "25–34": 1 } : null);
      if (!votes) continue;
      const times = Math.min(v.n, 5);
      for (const [b, x] of Object.entries(votes)) ageVotes[b] += x * times;
      ageEvidence.push(d);
    }
    const ageTotal = Object.values(ageVotes).reduce((a, b) => a + b, 0);
    const bestAge = Object.entries(ageVotes).sort((a, b) => b[1] - a[1])[0];
    add(
      "age",
      "Age range (guess)",
      ageTotal >= 6 ? bestAge[0] : null,
      Math.min(0.6, sat(ageTotal, 20) * (bestAge[1] / (ageTotal || 1))),
      ageEvidence.length ? [`Platforms with a known audience skew: ${ageEvidence.slice(0, 6).join(", ")}`] : [],
      "Needs a few visits to platforms with a known audience",
      "Unreliable: based only on which platforms you use"
    );

    // 10. Gender lean (guess): the crudest signal ad-tech uses, shown with low confidence on purpose
    const female = (cats.beauty || 0) * 2;
    const male = (cats.gaming || 0) + (cats.auto || 0);
    const diff = Math.abs(female - male);
    add(
      "gender",
      "Gender lean (guess)",
      diff >= 4 ? (female > male ? "Leans female" : "Leans male") : null,
      Math.min(0.5, sat(diff, 12)),
      diff >= 4 ? ["Based on topic stereotypes such as beauty, gaming and cars"] : [],
      "Needs a clear pattern of topic visits",
      "Stereotype-based and often wrong. Capped at low confidence"
    );

    // 11. Hair colour: nothing reveals it
    add("hair", "Hair colour", null, 0, [], "Nothing in your data reveals this");

    // Avatar and completeness
    const conf = (k) => (attrs.find((a) => a.key === k) || {}).conf || 0;
    const learned = attrs.filter((a) => a.group === "inferred");
    const completeness = learned.reduce((a, x) => a + x.conf, 0) / learned.length;
    const topCats = interests.slice(0, 4).map(([c]) => c);
    const style = topStyle.n >= 3 ? topStyle.key : null;
    const props = [];
    if (topCats.some((c) => ["music", "video"].includes(c))) props.push("headphones");
    if (topCats.includes("gaming")) props.push("gamepad");
    if (topCats.some((c) => ["dev", "tech"].includes(c))) props.push("laptop");
    if (topCats.includes("shopping") || conf("spending") > 0.3) props.push("bag");
    if (topCats.includes("travel")) props.push("plane");
    if (topCats.some((c) => ["sports", "fitness"].includes(c))) props.push("ball");
    if (topCats.includes("food")) props.push("fork");

    return { attrs, completeness, avatar: { revealed: completeness > 0.1, style, props, pages: sig.pages || 0 } };
  }

  return { infer, PRETTY };
})();
