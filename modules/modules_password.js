// ChatSeed Module: Password & Random Generator
// Drop this file in ./modules/ to add password generation capabilities
(function(MS){
  MS.register("password-gen", {
    name: "Password & Random Generator",
    description: "Generate secure random passwords, PINs, passphrases, token codes, or random numbers. All generated client-side.",
    tools: [{
      type: "function",
      function: {
        name: "generate_password",
        description: "Generate secure random passwords, PIN codes, or random numbers with customizable options.",
        parameters: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["password", "pin", "passphrase", "token", "number"], description: "Type of output" },
            length: { type: "number", description: "Length for password/pin/token (4-128). For 'number' type, this is the max value." },
            count: { type: "number", description: "How many to generate (1-10)", default: 1 }
          },
          required: ["type"]
        }
      }
    }],
    handleToolCall: async function(tn, args) {
      if (tn !== "generate_password") return null;
      try {
        var type = (args.type || "password").toLowerCase();
        var len = Math.min(Math.max(parseInt(args.length) || 16, 4), 128);
        var count = Math.min(Math.max(parseInt(args.count) || 1, 1), 10);
        var cryptoObj = window.crypto || window.msCrypto;
        var getBytes = function(n) { var arr = new Uint8Array(n); cryptoObj.getRandomValues(arr); return arr; };
        var upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        var lower = "abcdefghijklmnopqrstuvwxyz";
        var digits = "0123456789";
        var symbols = "!@#$%^&*()_+-=[]{}|;:,.<>?";
        var results = [];
        for (var c = 0; c < count; c++) {
          if (type === "pin") {
            var arr = getBytes(len); var pin = "";
            for (var i = 0; i < len; i++) pin += digits[arr[i] % 10];
            results.push(pin);
          } else if (type === "token") {
            var arr = getBytes(Math.ceil(len / 2)); var hex = "";
            for (var i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, "0");
            results.push(hex.substring(0, len).toUpperCase());
          } else if (type === "passphrase") {
            var wordList = ["apple","ocean","tiger","moon","river","stone","cloud","flame","storm","pixel","coral","ember","frost","grape","honey","ivory","jade","kite","lunar","mango","nitro","olive","pearl","quartz","raven","sable","topaz","ultra","vivid","whale","xenon","yacht","zebra","acorn","bloom","cider","drift","eagle","flame","grove","hazel","iris","jolly","koala","lemur","maple","nebula","orbit","pilot","ridge","solar","tulip","umbra","viper","wheat","algae","basil","coral","daisy","elm","fern","ginkgo","hickory","indigo","jasmine","kiwi","lavender","mint","nutmeg","orchid","palm","quince","rose","sage","thyme","ursa","verbena","willow","xerophyte","yucca","zinnia"];
            var arr = getBytes(len); var words = [];
            for (var i = 0; i < len; i++) words.push(wordList[arr[i] % wordList.length]);
            results.push(words.join("-"));
          } else if (type === "number") {
            var max = Math.min(len, 9999999);
            var arr = getBytes(count);
            for (var i = 0; i < count; i++) results.push((arr[i] % max) + 1);
            var lines = ["## 🔢 Random " + (count > 1 ? "Numbers" : "Number"), ""];
            for (var i = 0; i < results.length; i++) lines.push((results.length > 1 ? (i+1)+". " : "") + "`" + results[i] + "` (1–" + max + ")");
            return lines.join("\n");
          } else {
            var allChars = upper + lower + digits + symbols;
            var arr = getBytes(len); var pw = "";
            if (len >= 4) {
              pw += upper[arr[0] % upper.length];
              pw += lower[arr[1] % lower.length];
              pw += digits[arr[2] % digits.length];
              pw += symbols[arr[3] % symbols.length];
              for (var i = 4; i < len; i++) pw += allChars[arr[i] % allChars.length];
              var pwArr = pw.split("");
              for (var i = pwArr.length - 1; i > 0; i--) {
                var j = arr[i % arr.length] % (i + 1);
                var tmp = pwArr[i]; pwArr[i] = pwArr[j]; pwArr[j] = tmp;
              }
              pw = pwArr.join("");
            } else {
              for (var i = 0; i < len; i++) pw += allChars[arr[i] % allChars.length];
            }
            results.push(pw);
          }
        }
        var icons = { password: "🔐", pin: "🔢", passphrase: "🔑", token: "🪙", number: "🔢" };
        var lines = ["## " + (icons[type] || "🔐") + " Generated " + type.charAt(0).toUpperCase() + type.slice(1) + (count > 1 ? "s" : ""), ""];
        for (var i = 0; i < results.length; i++) {
          lines.push((results.length > 1 ? "**" + (i+1) + ".** " : "") + "`" + results[i] + "`");
        }
        var strength = len < 8 ? "⚠️ Weak" : len < 12 ? "🔸 Moderate" : len < 20 ? "✅ Strong" : "🛡️ Very Strong";
        if (type !== "number" && type !== "pin") lines.push(""); lines.push("*Length: " + len + " | " + strength + "*");
        return lines.join("\n");
      } catch(e) { return "Error: " + e.message; }
    }
  });
})(ModuleSystem);