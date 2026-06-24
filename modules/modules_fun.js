// ChatSeed Module: Jokes, Quotes & Fun Facts
// Drop this file in ./modules/ to add fun capabilities
(function(MS){
  MS.register("fun", {
    name: "Jokes, Quotes & Fun Facts",
    description: "Get random jokes, inspirational quotes, and fun facts using free public APIs.",
    tools: [
      {
        type: "function",
        function: {
          name: "get_joke",
          description: "Get a random joke (programming, dad jokes, general humor, or any category).",
          parameters: {
            type: "object",
            properties: {
              category: { type: "string", enum: ["any", "programming", "dad", "pun", "general"], description: "Joke category", default: "any" }
            },
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_quote",
          description: "Get a random inspirational or famous quote.",
          parameters: {
            type: "object",
            properties: {
              author: { type: "string", description: "Optional: get a quote by a specific author (e.g. Einstein, Shakespeare)" }
            },
            required: []
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_fact",
          description: "Get a random interesting fun fact.",
          parameters: { type: "object", properties: {}, required: [] }
        }
      }
    ],
    handleToolCall: async function(tn, args) {
      try {
        if (tn === "get_joke") {
          var cat = (args.category || "any").toLowerCase();
          var catMap = { any: "Any", programming: "Programming", dad: "Miscellaneous", pun: "Pun", general: "Miscellaneous" };
          var apiCat = catMap[cat] || "Any";
          var r = await fetch("https://v2.jokeapi.dev/joke/" + apiCat + "?safe-mode&format=json");
          if (!r.ok) throw Error("HTTP " + r.status);
          var d = await r.json();
          if (d.error) return "Couldn't fetch a joke right now.";
          var lines = ["## 😂 " + (d.category || "Random") + " Joke", ""];
          if (d.type === "single") lines.push(d.joke);
          else { lines.push("**" + d.setup + "**"); lines.push(""); lines.push("*" + d.delivery + "*  😄"); }
          return lines.join("\n");
        }
        if (tn === "get_quote") {
          var author = (args.author || "").trim();
          var url = author ? "https://api.quotable.io/quotes?author=" + encodeURIComponent(author) + "&limit=1" : "https://api.quotable.io/random";
          var r = await fetch(url);
          if (!r.ok) throw Error("HTTP " + r.status);
          var d = await r.json();
          var quote, quoteAuthor;
          if (author) {
            if (!d.results || d.results.length === 0) return 'No quotes found for "' + author + '". Try a different name.';
            quote = d.results[0].content; quoteAuthor = d.results[0].author;
          } else { quote = d.content; quoteAuthor = d.author; }
          return "## 💬 Quote\n\n> *" + quote + "*\n\n— **" + quoteAuthor + "**\n\n*Powered by Quotable.io*";
        }
        if (tn === "get_fact") {
          var r = await fetch("https://uselessfacts.jsph.pl/api/v2/facts/random?language=en");
          if (!r.ok) throw Error("HTTP " + r.status);
          var d = await r.json();
          return "## 🧠 Random Fun Fact\n\n" + d.text + "\n\n*Powered by Useless Facts API*";
        }
        return null;
      } catch(e) {
        if (tn === "get_joke") return "Joke service unavailable. Try again later! 🙂";
        if (tn === "get_quote") return "Quote service unavailable. Try again later!";
        if (tn === "get_fact") return "Fun fact service unavailable. Try again later!";
        return null;
      }
    }
  });
})(ModuleSystem);