// The avatar network: anonymous privacy scores and protection recipes.
//
// What is shared (only if the user opts in): an anonymous name, a score 0-100, the trackers the user
// blocks and the privacy habits they tick. Never browsing, sites, or the digital twin.
// Rankings are private: each person only sees their own position, never a list of others.
//
// Right now this runs on a SIMULATED population (deterministic, generated locally) so the whole
// experience works with no server and nothing leaves the device. A real backend would replace
// `population()` and `friendNetwork()`; the rest stays the same.
const Network = (() => {
  const TOOLS = [
    { id: "ublock", label: "uBlock Origin", tip: "Install uBlock Origin. It stops most trackers from loading at all." },
    { id: "badger", label: "Privacy Badger", tip: "Install Privacy Badger. It learns which sites track you and blocks them." },
    { id: "ghostery", label: "Ghostery", tip: "Install Ghostery for a simple tracker blocker with a clear dashboard." },
    { id: "firefox", label: "Firefox", tip: "Firefox blocks many trackers and some fingerprinting by default." },
    { id: "brave", label: "Brave", tip: "Brave blocks trackers and fingerprinting out of the box." },
    { id: "cookies", label: "Blocks third-party cookies", tip: "In Chrome: Settings, Privacy and security, Third-party cookies, then block them." },
    { id: "banners", label: "Rejects cookie banners", tip: 'On cookie banners, always choose "Reject all" or the most limited option.' },
    { id: "search", label: "Private search engine", tip: "Use a search engine that does not build a profile of you, such as DuckDuckGo or Startpage." },
    { id: "vpn", label: "VPN", tip: "A VPN hides your IP address from sites, though not what you do while logged in." },
  ];
  const toolLabel = (id) => (TOOLS.find((t) => t.id === id) || { label: id }).label;

  const POPULATION = 1000;
  const ADJ = ["Coral", "Kelp", "Tide", "Pearl", "Drift", "Brine", "Foam", "Marlin", "Squid", "Anchor", "Lagoon", "Atoll"];

  // Small seeded random generator so the simulated world is the same every time
  function rng(seed) {
    let s = seed >>> 0;
    return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  }
  const gauss = (r) => (r() + r() + r() + r() - 2) / 0.58; // roughly -3.4..3.4

  // Anonymous display name from any id string, for example "Kelp-42"
  function nameFromId(id) {
    let h = 2166136261;
    for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    h >>>= 0;
    return ADJ[h % ADJ.length] + "-" + (10 + ((h >>> 8) % 90));
  }

  function makePerson(r, id) {
    const score = Math.max(3, Math.min(98, Math.round(52 + gauss(r) * 20)));
    const names = typeof Trackers !== "undefined" ? Trackers.companyNames() : [];
    const pool = names.slice(0, 40);
    const count = Math.max(0, Math.min(pool.length, Math.round((score / 100) * 10 + (r() - 0.5) * 3)));
    const blocked = [];
    while (blocked.length < count && pool.length) {
      const pick = pool[Math.floor(Math.pow(r(), 1.5) * pool.length)]; // bias towards the big names
      if (!blocked.includes(pick)) blocked.push(pick);
    }
    const tools = TOOLS.filter((t) => r() < 0.05 + (score / 100) * 0.55).map((t) => t.id);
    if (tools.includes("firefox") && tools.includes("brave")) tools.splice(tools.indexOf("brave"), 1);
    return { id, name: nameFromId(id), score, blocked, tools };
  }

  let cache = null;
  function population() {
    if (cache) return cache;
    const r = rng(20261001);
    cache = Array.from({ length: POPULATION }, (_, i) => makePerson(r, "p" + i));
    return cache;
  }

  // A friends circle around the user: 6 friends, each with their own small network behind them
  function friendNetwork(me) {
    const pop = population();
    const r = rng(77 + String(me || "me").length);
    const sorted = [...pop].sort((a, b) => a.score - b.score);
    const nodes = [];
    for (let i = 0; i < 6; i++) {
      const p = sorted[Math.floor(((i + 0.5) / 6) * sorted.length * 0.92 + r() * 20)] || sorted[sorted.length - 1];
      const friend = { ...p, ring: 1, parent: "me" };
      nodes.push(friend);
      for (let k = 0; k < 2 + Math.floor(r() * 2); k++) {
        const q = pop[Math.floor(r() * pop.length)];
        if (q.id !== p.id && !nodes.some((n) => n.id === q.id)) nodes.push({ ...q, ring: 2, parent: p.id });
      }
    }
    return nodes;
  }

  // Everything the Network page needs. Rank views are only returned for networks the user has joined.
  function snapshot({ score, settings }) {
    const s = settings || {};
    const out = { demo: true, global: null, friends: null, topRecipes: [] };
    if (s.global) {
      const pop = population();
      const rank = 1 + pop.filter((p) => p.score > score).length;
      const total = pop.length + 1;
      out.global = { rank, total, topPercent: Math.max(1, Math.ceil((rank / total) * 100)) };
      out.topRecipes = [...pop].sort((a, b) => b.score - a.score).slice(0, 3);
    }
    if (s.friends) {
      const nodes = friendNetwork(s.anonId);
      const circle = nodes.filter((n) => n.ring === 1);
      out.friends = { nodes, rank: 1 + circle.filter((n) => n.score > score).length, total: circle.length + 1 };
    }
    return out;
  }

  // What others would see about the user, given their sharing choices
  function myRecipe({ score, settings, blockedCompanies }) {
    const s = settings || {};
    if (!s.global && !s.friends) return null;
    return {
      name: nameFromId(s.anonId || "me"),
      score,
      blocked: s.shareBlocked === false ? [] : blockedCompanies || [],
      tools: s.shareHabits === false ? [] : s.habits || [],
    };
  }

  // Companies from someone's recipe that the user does not block yet
  const toAdopt = (node, alreadyBlocked) => (node.blocked || []).filter((c) => !(alreadyBlocked || []).includes(c));

  return { TOOLS, toolLabel, nameFromId, population, snapshot, myRecipe, toAdopt, POPULATION };
})();
