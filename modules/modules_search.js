// Browser Search & Scrape Module for ChatSeed
// Uses the Browser Search/Scrape API endpoint
// Primary: POST to https://broadfield-dev-browser.hf.space/api/web_browse

(function(MS) {
  MS.register("search-web", {
    name: "Web Search 2.0",
    description: "Browser-based web search and page scraping using the broadfield-dev API endpoint.",
    tools: [
      // === Tool 1: Search ===
      {
        type: "function",
        function: {
          name: "search_web",
          description: "Search the internet for current information. Uses a browser-based search API to fetch live results. Returns titles, snippets, and URLs.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query - be specific for best results" },
              max_results: { type: "number", description: "Max results (1-10)", default: 5 },
              source: { type: "string", enum: ["auto", "web", "wikipedia", "news", "reddit"], description: "Source to search.", default: "auto" }
            },
            required: ["query"]
          }
        }
      },
      // === Tool 2: Scrape ===
      {
        type: "function",
        function: {
          name: "scrape_web",
          description: "Scrape/extract the full content of a webpage by URL. Uses a browser-based API to fetch and return the page's rendered content (text, HTML, or structured data).",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "The full URL of the webpage to scrape (e.g. https://example.com/page)" },
              max_length: { type: "number", description: "Maximum length of returned content in characters (100-50000)", default: 5000 }
            },
            required: ["url"]
          }
        }
      }
    ],
    handleToolCall: async function(tn, args) {
      // ================================================================
      // SEARCH HANDLER
      // ================================================================
      if (tn === "search_web") {
        try {
          var q = args.query;
          var mx = Math.min(Math.max(parseInt(args.max_results) || 5, 1), 10);
          var BROWSER_API = "https://broadfield-dev-browser-api.hf.space/web_browse";
          var allResults = [];

          // === Call the broadfield-dev browser API ===
          try {
            var payload = { action: "Search", query: q, browser: "webkit", search_engine: "DuckDuckGo" };
            var resp = await fetch(BROWSER_API, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(30000)
            });

            if (resp.ok) {
              var data = await resp.json();

              // Format: results array
              if (data.results && Array.isArray(data.results)) {
                for (var i = 0; i < data.results.length && allResults.length < mx; i++) {
                  var r = data.results[i];
                  var title = r.title || r.name || "";
                  var snippet = r.snippet || r.description || r.summary || "";
                  var urlStr = r.url || r.link || r.href || "";
                  if (title) allResults.push({ title: title, snippet: snippet, url: urlStr, source: "Web" });
                }
              }

              // Format: items array
              if (data.items && Array.isArray(data.items)) {
                for (var i = 0; i < data.items.length && allResults.length < mx; i++) {
                  var it = data.items[i];
                  var title = it.title || it.name || "";
                  var snippet = it.snippet || it.description || it.summary || "";
                  var urlStr = it.link || it.url || it.href || "";
                  if (title) allResults.push({ title: title, snippet: snippet, url: urlStr, source: "Web" });
                }
              }

              // Format: data array
              if (data.data && Array.isArray(data.data)) {
                for (var i = 0; i < data.data.length && allResults.length < mx; i++) {
                  var d = data.data[i];
                  var title = d.title || d.name || "";
                  var snippet = d.snippet || d.description || d.sampleText || "";
                  var urlStr = d.url || d.link || d.href || "";
                  if (title) allResults.push({ title: title, snippet: snippet, url: urlStr, source: "Web" });
                }
              }

              // Format: raw text/HTML content - extract links
              if ((data.html || data.text || data.content) && allResults.length === 0) {
                var htmlContent = data.html || data.text || data.content;
                if (typeof htmlContent === "string" && htmlContent.length > 50) {
                  var linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
                  var match;
                  while ((match = linkRegex.exec(htmlContent)) !== null && allResults.length < mx) {
                    var linkUrl = match[1];
                    var linkText = match[2].replace(/<[^>]*>/g, "").trim();
                    if (linkText && linkUrl && !linkUrl.startsWith("#") && !linkUrl.startsWith("javascript:")) {
                      if (linkUrl.startsWith("//")) linkUrl = "https:" + linkUrl;
                      else if (linkUrl.startsWith("/")) linkUrl = "https://google.com" + linkUrl;
                      else if (!linkUrl.startsWith("http")) linkUrl = "https://" + linkUrl;
                      var contextMatch = htmlContent.substring(Math.max(0, match.index - 150), match.index + match[0].length + 150);
                      var snippet = contextMatch.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().substring(0, 200);
                      allResults.push({ title: linkText, snippet: snippet, url: linkUrl, source: "Web" });
                    }
                  }
                }
              }

              // Format: success message with links in output text
              if (data.success && data.output && allResults.length === 0) {
                var output = typeof data.output === "string" ? data.output : JSON.stringify(data.output);
                var urlExtractRegex = /(https?:\/\/[^\s"'>)+]+)/g;
                var urlMatch;
                var idx = 0;
                while ((urlMatch = urlExtractRegex.exec(output)) !== null && allResults.length < mx) {
                  var foundUrl = urlMatch[1];
                  var before = output.substring(Math.max(0, urlMatch.index - 80), urlMatch.index);
                  var title = before.replace(/[|\[\]]/g, "").trim();
                  if (title.length > 50) title = title.substring(title.length - 50);
                  if (!title) title = "Result " + (idx + 1);
                  allResults.push({ title: title, snippet: output.substring(Math.max(0, urlMatch.index - 30), Math.min(output.length, urlMatch.index + 100)).replace(/\n/g, " ").trim(), url: foundUrl, source: "Web" });
                  idx++;
                }
              }

              // Last resort: format the entire response as a single result
              if (allResults.length === 0 && data) {
                var textContent = typeof data === "string" ? data : JSON.stringify(data);
                if (textContent && textContent.length > 20) {
                  allResults.push({ title: "Search Result", snippet: textContent.substring(0, 500), url: "", source: "Web" });
                }
              }
            } else {
              var errorText = await resp.text().catch(function() { return "Unknown error"; });
              allResults.push({ title: "API Error", snippet: "Primary API returned status " + resp.status + ": " + errorText.substring(0, 200), url: "", source: "Web" });
            }
          } catch(e) {
            allResults.push({ title: "Connection Error", snippet: "Could not reach the browser search API: " + e.message, url: "", source: "Web" });
          }

          // === DuckDuckGo fallback ===
          if (allResults.length === 0 || allResults[0].title === "API Error" || allResults[0].title === "Connection Error" || allResults[0].title === "Search Result") {
            try {
              var ddgUrl = "https://api.duckduckgo.com/?q=" + encodeURIComponent(q) + "&format=json&no_html=1&skip_disambig=1";
              var ddgResp = await fetch(ddgUrl, { method: "GET", signal: AbortSignal.timeout(10000) });
              if (ddgResp.ok) {
                var ddgData = await ddgResp.json();
                var ddgResults = [];
                if (ddgData.AbstractText) {
                  ddgResults.push({ title: ddgData.Headline || ddgData.Heading || "Summary", snippet: ddgData.AbstractText, url: ddgData.AbstractURL || "", source: "DuckDuckGo" });
                }
                var topics = ddgData.RelatedTopics || [];
                for (var i = 0; i < topics.length && ddgResults.length < mx; i++) {
                  var topic = topics[i];
                  if (topic.Topics && Array.isArray(topic.Topics)) {
                    for (var j = 0; j < topic.Topics.length && ddgResults.length < mx; j++) {
                      var sub = topic.Topics[j];
                      if (sub.Text || sub.FirstURL) ddgResults.push({ title: sub.Text ? sub.Text.split(" - ")[0] || sub.Text : "Result", snippet: sub.Text || "", url: sub.FirstURL || "", source: "DuckDuckGo" });
                    }
                  } else if (topic.Text || topic.FirstURL) {
                    ddgResults.push({ title: topic.Text ? topic.Text.split(" - ")[0] || topic.Text : "Result", snippet: topic.Text || "", url: topic.FirstURL || "", source: "DuckDuckGo" });
                  }
                }
                if (ddgData.Results && Array.isArray(ddgData.Results)) {
                  for (var i = 0; i < ddgData.Results.length && ddgResults.length < mx; i++) {
                    var res = ddgData.Results[i];
                    if (res.Text || res.FirstURL) ddgResults.push({ title: res.Text ? res.Text.split(" - ")[0] || res.Text : "Result", snippet: res.Text || "", url: res.FirstURL || "", source: "DuckDuckGo" });
                  }
                }
                if (ddgResults.length > 0) {
                  allResults = ddgResults;
                } else {
                  var htmlSearchUrl = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q);
                  var htmlResp = await fetch(htmlSearchUrl, { method: "GET", signal: AbortSignal.timeout(10000) });
                  if (htmlResp.ok) {
                    var htmlText = await htmlResp.text();
                    var linkRegex2 = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
                    var snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
                    var linkMatches = [], snippetMatches = [], lm, sm;
                    while ((lm = linkRegex2.exec(htmlText)) !== null) linkMatches.push({ url: lm[1], title: lm[2].replace(/<[^>]*>/g, "").trim() });
                    while ((sm = snippetRegex.exec(htmlText)) !== null) snippetMatches.push(sm[1].replace(/<[^>]*>/g, "").trim());
                    var htmlResults = [];
                    for (var i = 0; i < linkMatches.length && htmlResults.length < mx; i++) {
                      var lmi = linkMatches[i], snip = snippetMatches[i] || "", cleanUrl = lmi.url;
                      var redirectMatch = cleanUrl.match(/uddg=(https?[^&]+)/);
                      if (redirectMatch) cleanUrl = decodeURIComponent(redirectMatch[1]);
                      htmlResults.push({ title: lmi.title, snippet: snip, url: cleanUrl, source: "DuckDuckGo" });
                    }
                    if (htmlResults.length > 0) allResults = htmlResults;
                  }
                }
              }
            } catch(e) {
              if (allResults.length === 0 || allResults[0].title === "API Error" || allResults[0].title === "Connection Error") {
                allResults = [{ title: "Search Unavailable", snippet: "Both search methods are currently unavailable. Please try again later.", url: "", source: "Web" }];
              }
            }
          }

          // === Deduplicate ===
          var seen = {}, deduped = [];
          for (var i = 0; i < allResults.length && deduped.length < mx; i++) {
            var item = allResults[i];
            if (!item.title) continue;
            var key = item.url || item.snippet || item.title;
            if (key && !seen[key.substring(0, 100)]) { seen[key.substring(0, 100)] = true; deduped.push(item); }
          }

          // === Format output ===
          var out = ["## 🔍 Search Results: \"" + q + "\"", ""];
          if (deduped.length === 0) {
            out.push("*No results found. Try a different query.*");
          } else {
            for (var i = 0; i < deduped.length; i++) {
              var r = deduped[i];
              out.push("### " + (i + 1) + ". " + (r.title || ""));
              if (r.snippet) out.push("> " + r.snippet);
              if (r.url) out.push("🔗 " + r.url);
              out.push("");
            }
          }
          return out.join("\n");
        } catch(e) {
          return "## 🔍 Search: \"" + args.query + "\"\n\n❌ Error: " + e.message;
        }
      }

      // ================================================================
      // SCRAPE HANDLER
      // ================================================================
      if (tn === "scrape_web") {
        try {
          var urlToScrape = args.url;
          var maxLen = Math.min(Math.max(parseInt(args.max_length) || 5000, 100), 50000);
          var BROWSER_API = "https://broadfield-dev-browser-api.hf.space/web_browse";
          var out = ["## 📄 Scrape: " + urlToScrape, ""];

          try {
            var payload = { action: "Scrape", query: urlToScrape, browser: "webkit" };
            var resp = await fetch(BROWSER_API, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(60000)
            });

            if (resp.ok) {
              var data = await resp.json();
              var content = "";

              // Try to extract content in various formats
              if (data.text && typeof data.text === "string") {
                content = data.text;
              } else if (data.content && typeof data.content === "string") {
                content = data.content;
              } else if (data.html && typeof data.html === "string") {
                content = data.html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
                                  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
                                  .replace(/<[^>]+>/g, " ")
                                  .replace(/&[a-z]+;/g, " ")
                                  .replace(/\s+/g, " ")
                                  .trim();
              } else if (data.body && typeof data.body === "string") {
                content = data.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
              } else if (data.markdown && typeof data.markdown === "string") {
                content = data.markdown;
              } else if (data.title || data.description) {
                content = "Title: " + (data.title || "") + "\nDescription: " + (data.description || "");
                if (data.headings) content += "\n\nHeadings: " + (Array.isArray(data.headings) ? data.headings.join(", ") : data.headings);
              } else {
                var stringified = JSON.stringify(data, null, 2);
                if (stringified.length > maxLen * 2) stringified = stringified.substring(0, maxLen * 2) + "\n... [truncated]";
                content = stringified;
              }

              // Truncate if needed
              if (content.length > maxLen) {
                content = content.substring(0, maxLen) + "\n\n... [Content truncated. Use a higher max_length to get more.]";
              }

              if (content && content.trim().length > 0) {
                out.push("**Title:** " + (data.title || data.heading || "N/A"));
                if (data.description) out.push("**Description:** " + data.description);
                out.push("");
                out.push("```\n" + content + "\n```");
              } else {
                out.push("*No readable content could be extracted from this page.*");
                out.push("");
                out.push("Raw response keys: " + Object.keys(data).join(", "));
              }
            } else {
              var errorText = await resp.text().catch(function() { return "Unknown error"; });
              out.push("❌ **API Error:** The scrape API returned status " + resp.status);
              out.push("> " + errorText.substring(0, 500));
            }
          } catch(e) {
            out.push("❌ **Connection Error:** Could not reach the scrape API: " + e.message);
          }

          return out.join("\n");
        } catch(e) {
          return "## 📄 Scrape Error\n\n❌ Error: " + e.message;
        }
      }

      return null;
    }
  });
})(ModuleSystem);