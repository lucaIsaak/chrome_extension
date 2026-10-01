// Weekly privacy report and "reef health" score. Pure functions, shared by the recorder
// (service worker) and the pages so both always agree.
//
// Input: the daily buckets kept by shadow.js, keyed "YYYY-MM-DD":
//   { trackReq, watch: { company: { site: requests } }, blocked: { n, byCompany: { name: n } }, ... }
const Report = (() => {
  const dayKey = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

  // Add up the days from `olderAgo` days back to `newerAgo` days back (0 = today)
  function sumRange(days, olderAgo, newerAgo) {
    const companies = {}; // company -> Set of sites it watched you on
    const sites = {}; // site -> Set of companies seen on it
    let trackReq = 0;
    let blocked = 0;
    let daysWithData = 0;
    const blockedBy = {};
    for (let i = olderAgo; i >= newerAgo; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const b = days && days[dayKey(d)];
      if (!b) continue;
      daysWithData++;
      trackReq += b.trackReq || 0;
      if (b.blocked) {
        blocked += b.blocked.n || 0;
        for (const [name, n] of Object.entries(b.blocked.byCompany || {})) blockedBy[name] = (blockedBy[name] || 0) + n;
      }
      for (const [company, perSite] of Object.entries(b.watch || {})) {
        for (const site of Object.keys(perSite)) {
          (companies[company] = companies[company] || new Set()).add(site);
          (sites[site] = sites[site] || new Set()).add(company);
        }
      }
    }
    return { companies, sites, trackReq, blocked, blockedBy, daysWithData };
  }

  function weekly(days) {
    const cur = sumRange(days, 6, 0);
    const prev = sumRange(days, 13, 7);
    const companyCount = Object.keys(cur.companies).length;
    const prevCount = Object.keys(prev.companies).length;
    const worst = Object.entries(cur.sites).sort((a, b) => b[1].size - a[1].size)[0];
    const top = Object.entries(cur.companies).sort((a, b) => b[1].size - a[1].size)[0];
    return {
      hasData: cur.daysWithData > 0,
      hasPrev: prev.daysWithData > 0,
      companies: companyCount,
      prevCompanies: prevCount,
      delta: companyCount - prevCount,
      sitesSeen: Object.keys(cur.sites).length,
      worstSite: worst ? { site: worst[0], companies: worst[1].size } : null,
      topWatcher: top ? { name: top[0], sites: top[1].size } : null,
      trackReq: cur.trackReq,
      blocked: cur.blocked,
      blockedBy: cur.blockedBy,
    };
  }

  // 0..100. Fewer companies watching you and more tracking blocked means a healthier reef.
  function health(w) {
    if (!w || !w.hasData) return 60; // neutral until there is something to judge
    const exposure = Math.min(70, w.companies * 1.4);
    const share = w.blocked / Math.max(1, w.blocked + w.trackReq);
    return Math.max(10, Math.min(100, Math.round(100 - exposure + Math.min(30, share * 60))));
  }

  return { weekly, health, dayKey };
})();
