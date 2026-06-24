// ChatSeed Module: Dictionary & Thesaurus
// Drop this file in ./modules/ to add word lookup capabilities
(function(MS){
  MS.register("dictionary", {
    name: "Dictionary & Thesaurus",
    description: "Look up word definitions, pronunciations, and synonyms using the free Dictionary API.",
    tools: [{
      type: "function",
      function: {
        name: "define_word",
        description: "Get the definition, pronunciation, and examples for any English word.",
        parameters: {
          type: "object",
          properties: {
            word: { type: "string", description: "The word to look up" }
          },
          required: ["word"]
        }
      }
    }],
    handleToolCall: async function(tn, args) {
      if (tn !== "define_word") return null;
      try {
        var word = (args.word || "").trim().toLowerCase();
        if (!word) return "Please provide a word to look up.";
        var r = await fetch("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(word));
        if (!r.ok) {
          if (r.status === 404) return '❌ No definition found for "' + word + '". Check your spelling or try another word.';
          throw Error("HTTP " + r.status);
        }
        var data = await r.json();
        if (!data || !data[0]) return 'No results for "' + word + '".';
        var entry = data[0];
        var lines = ["## 📖 " + entry.word, ""];
        if (entry.phonetics && entry.phonetics.length > 0) {
          var phoneticText = "";
          for (var i = 0; i < entry.phonetics.length; i++) {
            if (entry.phonetics[i].text) { phoneticText = entry.phonetics[i].text; break; }
          }
          if (phoneticText) lines.push("🔊 */ " + phoneticText + " /*");
        }
        if (entry.meanings) for (var m = 0; m < entry.meanings.length; m++) {
          var meaning = entry.meanings[m];
          lines.push("### *" + (meaning.partOfSpeech || "?") + "*");
          if (meaning.definitions) {
            var defNum = 0;
            for (var d = 0; d < meaning.definitions.length && defNum < 3; d++) {
              var def = meaning.definitions[d];
              if (!def.definition) continue;
              defNum++;
              lines.push("**" + defNum + ".** " + def.definition);
              if (def.example) lines.push("> *\"" + def.example + "\"*");
              if (def.synonyms && def.synonyms.length > 0)
                lines.push("   *Synonyms:* " + def.synonyms.slice(0, 5).join(", "));
            }
          }
        }
        lines.push(""); lines.push("*Powered by Free Dictionary API*");
        return lines.join("\n");
      } catch(e) { return "Dictionary error: " + e.message; }
    }
  });
})(ModuleSystem);