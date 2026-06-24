// ChatSeed Module: News Headlines
// Drop this file in ./modules/ to add news capabilities
(function(MS){
  var RSS_SOURCES = {
    "top": "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
    "world": "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "technology": "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
    "science": "https://rss.nytimes.com/services/xml/rss/nyt/Science.xml",
    "business": "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
    "sports": "https://rss.nytimes.com/services/xml/rss/nyt/Sports.xml",
    "health": "https://rss.nytimes.com/services/xml/rss/nyt/Health.xml"
  };
  var FALLBACK_SOURCES = [
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://www.reddit.com/r/worldnews/.rss"
  ];
  async function fetchRSS(url) {
    try {
      var r = await fetch("https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(url));
      if (!r.ok) return null;
      var d = await r.json();
      if (d.status !== "ok" || !d.items) return null;
      return d.items;
    } catch(e) { return null; }
  }
  MS.register("news", {
    name: "News Headlines",
    description: "Fetch latest news headlines from RSS feeds (NYT, BBC, Reddit) — no API key required.",
    tools: [{
      type: "function",
      function: {
        name: "get_news",
        description: "Get latest news headlines. Supports topics: top, world, technology, science, business, sports, health. Leave query empty for top stories.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Topic: top, world, technology, science, business, sports, health, or custom search term" },
            max_results: { type: "number", description: "Number of headlines (1-10)", default: 5 }
          },
          required: []
        }
      }
    }],
    handleToolCall: async function(tn, args) {
      if (tn !== "get_news") return null;
      try {
        var q = (args.query || "").toLowerCase().trim();
        var mx = Math.min(Math.max(parseInt(args.max_results) || 5, 1), 10);
        var items = null;
        var sourceName = "";

        if (q && RSS_SOURCES[q]) {
          items = await fetchRSS(RSS_SOURCES[q]);
          sourceName = "NYT " + q.charAt(0).toUpperCase() + q.slice(1);
        }

        if (!items || items.length === 0) {
          for (var i = 0; i < FALLBACK_SOURCES.length; i++) {
            items = await fetchRSS(FALLBACK_SOURCES[i]);
            if (items && items.length > 0) {
              sourceName = FALLBACK_SOURCES[i].includes("bbc") ? "BBC News" : "Reddit";
              break;
            }
          }
        }

        if (!items || items.length === 0) return "No news available at the moment. Try again later.";

        var l = ["## 📰 News" + (q && RSS_SOURCES[q] ? ": " + q : "") + " (via " + sourceName + ")", ""];
        var count = 0;
        for (var i = 0; i < items.length && count < mx; i++) {
          var item = items[i];
          if (!item.title) continue;
          count++;
          l.push("### " + count + ". " + item.title);
          if (item.author) l.push("*By " + item.author + "*");
          else if (item.source && item.source.name) l.push("*" + item.source.name + "*");
          if (item.pubDate) l.push("📅 " + new Date(item.pubDate).toLocaleDateString());
          if (item.description) l.push("> " + item.description.replace(/<[^>]*>/g, "").substring(0, 250));
          if (item.link) l.push("🔗 " + item.link);
          l.push("");
        }
        return l.join("\n");
      } catch(e) { return "News unavailable: " + e.message; }
    }
  });
})(ModuleSystem);