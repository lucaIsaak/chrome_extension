// Classifies websites and page text into interest categories, and filters sensitive sites.
// Everything runs locally. Page text is classified and then thrown away.
const Cats = (() => {
  const DOMAINS = {
    social: ["facebook.com", "instagram.com", "tiktok.com", "snapchat.com", "x.com", "twitter.com", "reddit.com", "pinterest.com", "linkedin.com", "discord.com", "whatsapp.com", "telegram.org", "threads.net", "tumblr.com", "mastodon.social"],
    video: ["youtube.com", "netflix.com", "twitch.tv", "vimeo.com", "disneyplus.com", "primevideo.com", "dazn.com", "joyn.de", "ardmediathek.de", "zdf.de", "max.com", "paramountplus.com"],
    music: ["spotify.com", "soundcloud.com", "deezer.com", "bandcamp.com", "genius.com", "last.fm"],
    gaming: ["steampowered.com", "epicgames.com", "roblox.com", "playstation.com", "xbox.com", "nintendo.com", "ign.com", "gamespot.com", "battle.net", "riotgames.com", "leagueoflegends.com", "gog.com", "itch.io", "twitch.tv"],
    shopping: ["amazon.com", "amazon.de", "amazon.co.uk", "ebay.com", "ebay.de", "aliexpress.com", "temu.com", "shein.com", "etsy.com", "otto.de", "zalando.de", "mediamarkt.de", "saturn.de", "idealo.de", "kleinanzeigen.de", "vinted.de", "vinted.com", "ikea.com", "lidl.de", "walmart.com", "target.com", "bestbuy.com", "wish.com", "mydealz.de", "geizhals.de", "notebooksbilliger.de", "groupon.com", "farfetch.com"],
    fashion: ["zalando.de", "zalando.com", "hm.com", "zara.com", "nike.com", "adidas.com", "puma.com", "aboutyou.de", "asos.com", "uniqlo.com", "shein.com", "farfetch.com", "patagonia.com", "thenorthface.com", "stockx.com", "decathlon.de", "decathlon.com", "sportscheck.com", "newbalance.com", "primark.com", "vinted.de", "vinted.com", "mytheresa.com", "ssense.com", "net-a-porter.com", "hugoboss.com", "suitsupply.com"],
    sports: ["espn.com", "kicker.de", "sportschau.de", "transfermarkt.de", "transfermarkt.com", "fifa.com", "uefa.com", "nba.com", "sport1.de", "bundesliga.com", "skysports.com", "formula1.com"],
    news: ["bbc.com", "bbc.co.uk", "cnn.com", "nytimes.com", "theguardian.com", "spiegel.de", "zeit.de", "faz.net", "tagesschau.de", "bild.de", "welt.de", "sueddeutsche.de", "t-online.de", "reuters.com", "bloomberg.com", "washingtonpost.com", "focus.de", "n-tv.de", "stern.de", "handelsblatt.com", "ft.com"],
    tech: ["heise.de", "theverge.com", "techcrunch.com", "wired.com", "arstechnica.com", "golem.de", "computerbase.de", "engadget.com", "ycombinator.com", "producthunt.com", "chip.de", "netzwelt.de"],
    dev: ["github.com", "gitlab.com", "stackoverflow.com", "npmjs.com", "mozilla.org", "python.org", "dev.to", "vercel.com", "netlify.com", "codepen.io", "w3schools.com", "stackexchange.com", "docker.com", "kubernetes.io", "rust-lang.org", "nodejs.org"],
    finance: ["paypal.com", "n26.com", "finanzen.net", "boerse.de", "comdirect.de", "ing.de", "sparkasse.de", "dkb.de", "traderepublic.com", "scalable.capital", "tradingview.com", "investing.com", "wise.com", "revolut.com", "klarna.com", "check24.de", "verivox.de"],
    crypto: ["coinbase.com", "binance.com", "coinmarketcap.com", "coingecko.com", "kraken.com"],
    travel: ["booking.com", "airbnb.com", "expedia.com", "skyscanner.net", "skyscanner.com", "tripadvisor.com", "lufthansa.com", "bahn.de", "flixbus.de", "kayak.com", "ryanair.com", "easyjet.com", "hostelworld.com", "holidaycheck.de", "urlaubsguru.de"],
    food: ["chefkoch.de", "lieferando.de", "ubereats.com", "doordash.com", "allrecipes.com", "tasty.co", "hellofresh.de", "wolt.com", "foodora.de", "gutekueche.at"],
    fitness: ["strava.com", "myfitnesspal.com", "fitbit.com", "gymshark.com", "freeletics.com", "runtastic.com", "komoot.com", "garmin.com"],
    education: ["coursera.org", "udemy.com", "edx.org", "khanacademy.org", "duolingo.com", "wikipedia.org", "moodle.org", "studydrive.net", "quizlet.com", "brilliant.org", "scribd.com", "leo.org", "dict.cc", "deepl.com"],
    jobs: ["indeed.com", "stepstone.de", "xing.com", "glassdoor.com", "monster.com", "join.com", "linkedin.com", "arbeitsagentur.de"],
    entertainment: ["imdb.com", "rottentomatoes.com", "9gag.com", "buzzfeed.com", "kino.de", "tvspielfilm.de", "letterboxd.com"],
    beauty: ["sephora.com", "douglas.de", "flaconi.de", "notino.de", "notino.com", "glossybox.de", "rossmann.de", "dm.de", "ulta.com"],
    auto: ["autoscout24.de", "mobile.de", "bmw.de", "mercedes-benz.com", "tesla.com", "adac.de", "carwow.co.uk", "audi.de"],
    home: ["ikea.com", "hornbach.de", "obi.de", "bauhaus.info", "westwing.de", "houzz.com", "wayfair.com", "home24.de"],
    productivity: ["notion.so", "trello.com", "slack.com", "zoom.us", "office.com", "asana.com", "atlassian.net", "figma.com", "canva.com", "miro.com", "docusign.com"],
    utility: ["google.com", "bing.com", "duckduckgo.com", "web.de", "gmx.net", "outlook.com", "live.com", "proton.me", "icloud.com", "yahoo.com", "ecosia.org", "maps.google.com"],
  };

  // Categories that describe tools rather than interests (not shown as interests)
  const NON_INTEREST = new Set(["utility", "productivity"]);

  const BY_DOMAIN = {};
  for (const [cat, list] of Object.entries(DOMAINS)) {
    for (const d of list) (BY_DOMAIN[d] = BY_DOMAIN[d] || []).push(cat);
  }

  const KEYWORDS = {
    shopping: /\b(shop|store|buy|cart|deals?|sale|angebot|angebote|kaufen|warenkorb|bestellen|gutschein|coupon)\b/i,
    fashion: /\b(fashion|mode|outfit|clothing|sneakers?|dress|jacket|jeans|kleid|schuhe)\b/i,
    travel: /\b(travel|flights?|hotels?|vacation|urlaub|reise|flug|trip|holiday)\b/i,
    food: /\b(recipes?|rezepte?|cooking|kochen|restaurants?|delivery)\b/i,
    fitness: /\b(workout|fitness|gym|running|yoga|marathon|laufen)\b/i,
    sports: /\b(football|soccer|fußball|bundesliga|nba|tennis|formula 1|sport)\b/i,
    tech: /\b(software|gadgets?|smartphone|laptop|programming|artificial intelligence|tech)\b/i,
    dev: /\b(api|github|javascript|python|developer|documentation|npm|docker|kubernetes)\b/i,
    finance: /\b(bank|loan|credit|invest|stocks?|etf|aktien|kredit|versicherung|insurance|konto|tax|steuer)\b/i,
    crypto: /\b(bitcoin|crypto|ethereum|blockchain)\b/i,
    gaming: /\b(games?|gaming|gameplay|steam|playstation|xbox|esports|walkthrough)\b/i,
    music: /\b(music|album|songs?|playlist|lyrics|konzert|concert)\b/i,
    video: /\b(video|stream|watch|episode|series|serie|film|trailer)\b/i,
    news: /\b(news|nachrichten|breaking)\b/i,
    education: /\b(course|tutorial|learn|lesson|university|universität|study|studium|lernen|exam)\b/i,
    jobs: /\b(jobs?|career|karriere|stellenangebot|hiring|resume|lebenslauf|bewerbung)\b/i,
    beauty: /\b(beauty|makeup|skincare|cosmetics|kosmetik|parfum|haircare)\b/i,
    auto: /\b(cars?|automotive|gebrauchtwagen|bmw|audi|mercedes)\b/i,
    home: /\b(furniture|möbel|garden|garten|diy|renovation|baumarkt|interior)\b/i,
  };

  // Sites that are never recorded and never classified: adult, dating, medical, political parties.
  const SENSITIVE = [
    /(porn|xxx|\bsex\b|sexy|erotic|escort|onlyfans|nsfw|hentai|camgirl)/i,
    /(dating|tinder|grindr|bumble|hinge|okcupid|parship|elitepartner|lovoo|badoo)/i,
    /(doctolib|clinic|klinik|diagnos|symptom|therapie|therapy|\bhiv\b|cancer|krebs|depress|psychiat|abortion|pregnan|schwanger)/i,
    /(^|\.)(afd|cdu|csu|spd|gruene|fdp|dielinke|republican|democrats?|labour|conservatives)\.(de|org|com|uk|party|net)$/i,
  ];

  const isSensitive = (text) => SENSITIVE.some((re) => re.test(String(text || "")));

  function classifyHost(host) {
    host = String(host || "").toLowerCase();
    const parts = host.split(".");
    const out = new Set();
    for (let i = 0; i < parts.length - 1; i++) {
      const hit = BY_DOMAIN[parts.slice(i).join(".")];
      if (hit) hit.forEach((c) => out.add(c));
    }
    return [...out];
  }

  function classifyText(text) {
    const out = [];
    for (const [cat, re] of Object.entries(KEYWORDS)) if (re.test(text)) out.push(cat);
    return out;
  }

  return { DOMAINS, NON_INTEREST, classifyHost, classifyText, isSensitive };
})();
