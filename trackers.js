// A small built-in list of well-known trackers: domain -> [company, category].
// Categories: advertising, analytics, social, session-replay, data-broker, tag-manager, cdn.
const Trackers = (() => {
  const LIST = {
    // Google
    "google-analytics.com": ["Google", "analytics"],
    "googletagmanager.com": ["Google", "tag-manager"],
    "googletagservices.com": ["Google", "advertising"],
    "doubleclick.net": ["Google", "advertising"],
    "googlesyndication.com": ["Google", "advertising"],
    "googleadservices.com": ["Google", "advertising"],
    "admob.com": ["Google", "advertising"],
    "googleapis.com": ["Google", "cdn"],
    "gstatic.com": ["Google", "cdn"],
    "ggpht.com": ["Google", "cdn"],
    // Meta
    "facebook.com": ["Meta", "social"],
    "facebook.net": ["Meta", "social"],
    "fbcdn.net": ["Meta", "cdn"],
    "instagram.com": ["Meta", "social"],
    // Microsoft
    "clarity.ms": ["Microsoft", "session-replay"],
    "bat.bing.com": ["Microsoft", "advertising"],
    "linkedin.com": ["LinkedIn", "social"],
    "licdn.com": ["LinkedIn", "social"],
    // Other social / platforms
    "twitter.com": ["X", "social"],
    "x.com": ["X", "social"],
    "t.co": ["X", "social"],
    "ads-twitter.com": ["X", "advertising"],
    "tiktok.com": ["TikTok", "social"],
    "tiktokcdn.com": ["TikTok", "cdn"],
    "snapchat.com": ["Snap", "social"],
    "sc-static.net": ["Snap", "advertising"],
    "pinterest.com": ["Pinterest", "social"],
    "pinimg.com": ["Pinterest", "cdn"],
    "reddit.com": ["Reddit", "social"],
    "redditmedia.com": ["Reddit", "social"],
    "youtube.com": ["Google", "social"],
    "ytimg.com": ["Google", "cdn"],
    // Amazon
    "amazon-adsystem.com": ["Amazon", "advertising"],
    // Ad exchanges and retargeting
    "criteo.com": ["Criteo", "advertising"],
    "criteo.net": ["Criteo", "advertising"],
    "taboola.com": ["Taboola", "advertising"],
    "outbrain.com": ["Outbrain", "advertising"],
    "adnxs.com": ["Xandr (Microsoft)", "advertising"],
    "rubiconproject.com": ["Magnite", "advertising"],
    "pubmatic.com": ["PubMatic", "advertising"],
    "openx.net": ["OpenX", "advertising"],
    "casalemedia.com": ["Index Exchange", "advertising"],
    "indexww.com": ["Index Exchange", "advertising"],
    "smartadserver.com": ["Equativ", "advertising"],
    "adform.net": ["Adform", "advertising"],
    "adsrvr.org": ["The Trade Desk", "advertising"],
    "3lift.com": ["TripleLift", "advertising"],
    "sharethrough.com": ["Sharethrough", "advertising"],
    "teads.tv": ["Teads", "advertising"],
    "mathtag.com": ["MediaMath", "advertising"],
    "yieldlab.net": ["Yieldlab", "advertising"],
    "ayads.co": ["Ayads", "advertising"],
    "moatads.com": ["Oracle", "advertising"],
    "adsymptotic.com": ["Oracle", "advertising"],
    "bidswitch.net": ["IPONWEB", "advertising"],
    "contextweb.com": ["PulsePoint", "advertising"],
    "serving-sys.com": ["Sizmek", "advertising"],
    "tapad.com": ["Tapad", "data-broker"],
    // Data brokers / DMPs
    "demdex.net": ["Adobe", "data-broker"],
    "bluekai.com": ["Oracle", "data-broker"],
    "krxd.net": ["Salesforce", "data-broker"],
    "rlcdn.com": ["LiveRamp", "data-broker"],
    "liveramp.com": ["LiveRamp", "data-broker"],
    "agkn.com": ["Neustar", "data-broker"],
    "exelator.com": ["Nielsen", "data-broker"],
    "scorecardresearch.com": ["Comscore", "analytics"],
    "quantserve.com": ["Quantcast", "analytics"],
    "quantcount.com": ["Quantcast", "analytics"],
    // Analytics and product tools
    "omtrdc.net": ["Adobe", "analytics"],
    "2o7.net": ["Adobe", "analytics"],
    "adobedtm.com": ["Adobe", "tag-manager"],
    "hotjar.com": ["Hotjar", "session-replay"],
    "hotjar.io": ["Hotjar", "session-replay"],
    "fullstory.com": ["FullStory", "session-replay"],
    "mouseflow.com": ["Mouseflow", "session-replay"],
    "smartlook.com": ["Smartlook", "session-replay"],
    "luckyorange.com": ["Lucky Orange", "session-replay"],
    "crazyegg.com": ["Crazy Egg", "session-replay"],
    "segment.com": ["Twilio Segment", "analytics"],
    "segment.io": ["Twilio Segment", "analytics"],
    "mixpanel.com": ["Mixpanel", "analytics"],
    "amplitude.com": ["Amplitude", "analytics"],
    "heap.io": ["Heap", "analytics"],
    "heapanalytics.com": ["Heap", "analytics"],
    "optimizely.com": ["Optimizely", "analytics"],
    "nr-data.net": ["New Relic", "analytics"],
    "newrelic.com": ["New Relic", "analytics"],
    "sentry.io": ["Sentry", "analytics"],
    "hs-analytics.net": ["HubSpot", "analytics"],
    "hubspot.com": ["HubSpot", "analytics"],
    "hsforms.com": ["HubSpot", "analytics"],
    "marketo.net": ["Adobe", "analytics"],
    "pardot.com": ["Salesforce", "analytics"],
    "chartbeat.com": ["Chartbeat", "analytics"],
    "chartbeat.net": ["Chartbeat", "analytics"],
    "parsely.com": ["Parse.ly", "analytics"],
    "mc.yandex.ru": ["Yandex", "analytics"],
    "yandex.ru": ["Yandex", "analytics"],
    "branch.io": ["Branch", "analytics"],
    "appsflyer.com": ["AppsFlyer", "analytics"],
    "adjust.com": ["Adjust", "analytics"],
    "onetrust.com": ["OneTrust", "tag-manager"],
    "cookielaw.org": ["OneTrust", "tag-manager"],
    "usercentrics.eu": ["Usercentrics", "tag-manager"],
    // Infrastructure (not tracking by itself)
    "cloudfront.net": ["Amazon", "cdn"],
    "cloudflare.com": ["Cloudflare", "cdn"],
    "cdnjs.cloudflare.com": ["Cloudflare", "cdn"],
    "jsdelivr.net": ["jsDelivr", "cdn"],
    "unpkg.com": ["unpkg", "cdn"],
    "akamaihd.net": ["Akamai", "cdn"],
    "akamaized.net": ["Akamai", "cdn"],
    "fastly.net": ["Fastly", "cdn"],
    "bootstrapcdn.com": ["jsDelivr", "cdn"],
    "fontawesome.com": ["Font Awesome", "cdn"],
    "jquery.com": ["jQuery", "cdn"],
  };

  // Categories that count as tracking in the exposure score
  const TRACKING = new Set(["advertising", "analytics", "social", "session-replay", "data-broker"]);

  // Walk up the host name: "px.ads.linkedin.com" -> "ads.linkedin.com" -> "linkedin.com"
  function lookup(host) {
    const parts = String(host || "").toLowerCase().split(".");
    for (let i = 0; i < parts.length - 1; i++) {
      const hit = LIST[parts.slice(i).join(".")];
      if (hit) return { company: hit[0], cat: hit[1] };
    }
    return null;
  }

  return { lookup, TRACKING };
})();
