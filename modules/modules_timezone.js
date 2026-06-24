// ChatSeed Module: Time Zone Converter
// Drop this file in ./modules/ to add time zone capabilities
(function(MS){
  MS.register("timezone", {
    name: "Time Zone Converter",
    description: "Get current time anywhere, convert times between time zones.",
    tools: [
      {
        type: "function",
        function: {
          name: "get_time",
          description: "Get current time in any city or time zone. Use 'all' to see times around the world.",
          parameters: {
            type: "object",
            properties: {
              location: { type: "string", description: "City name (e.g. 'Tokyo'), timezone (e.g. 'Asia/Tokyo'), or 'all'" }
            },
            required: ["location"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "convert_time",
          description: "Convert a time between two time zones.",
          parameters: {
            type: "object",
            properties: {
              time: { type: "string", description: "Time like '3:00 PM' or 'now'" },
              from_zone: { type: "string", description: "Source timezone or city" },
              to_zone: { type: "string", description: "Target timezone or city" }
            },
            required: ["time", "from_zone", "to_zone"]
          }
        }
      }
    ],
    handleToolCall: async function(tn, args) {
      // get_time
      if (tn === "get_time") {
        try {
          var loc = (args.location || "").trim().toLowerCase();
          if (loc === "all") {
            var cities = ["New York", "London", "Tokyo", "Sydney", "Dubai", "Paris", "Los Angeles", "Singapore", "Mumbai", "Berlin", "Toronto", "São Paulo", "Seoul", "Cairo", "Mexico City"];
            var lines = ["## 🌍 World Clock", ""];
            for (var i = 0; i < cities.length; i++) {
              try {
                var t = new Date().toLocaleString("en-US", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/^Etc\//,"") });
                // Try common IANA timezones
                var tzMap = {
                  "new york": "America/New_York", "london": "Europe/London", "tokyo": "Asia/Tokyo",
                  "sydney": "Australia/Sydney", "dubai": "Asia/Dubai", "paris": "Europe/Paris",
                  "los angeles": "America/Los_Angeles", "singapore": "Asia/Singapore", "mumbai": "Asia/Kolkata",
                  "berlin": "Europe/Berlin", "toronto": "America/Toronto", "são paulo": "America/Sao_Paulo",
                  "seoul": "Asia/Seoul", "cairo": "Africa/Cairo", "mexico city": "America/Mexico_City"
                };
                var tz = tzMap[cities[i].toLowerCase()] || "UTC";
                var time = new Date().toLocaleString("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: true });
                var date = new Date().toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
                lines.push("**" + cities[i] + "** — " + time + " (" + date + ")");
              } catch(e2) {
                lines.push("**" + cities[i] + "** — unavailable");
              }
            }
            return lines.join("\n");
          } else {
            // Try to resolve city to timezone
            var tzMap = {
              "new york": "America/New_York", "london": "Europe/London", "tokyo": "Asia/Tokyo",
              "sydney": "Australia/Sydney", "dubai": "Asia/Dubai", "paris": "Europe/Paris",
              "los angeles": "America/Los_Angeles", "chicago": "America/Chicago", "denver": "America/Denver",
              "singapore": "Asia/Singapore", "mumbai": "Asia/Kolkata", "berlin": "Europe/Berlin",
              "toronto": "America/Toronto", "seoul": "Asia/Seoul", "beijing": "Asia/Shanghai",
              "hong kong": "Asia/Hong_Kong", "moscow": "Europe/Moscow", "istanbul": "Europe/Istanbul",
              "rome": "Europe/Rome", "madrid": "Europe/Madrid", "amsterdam": "Europe/Amsterdam",
              "bangkok": "Asia/Bangkok", "lagos": "Africa/Lagos", "nairobi": "Africa/Nairobi",
              "auckland": "Pacific/Auckland", "honolulu": "Pacific/Honolulu", "anchorage": "America/Anchorage",
              "cairo": "Africa/Cairo", "jakarta": "Asia/Jakarta", "karachi": "Asia/Karachi",
              "dhaka": "Asia/Dhaka", "manila": "Asia/Manila", "kolkata": "Asia/Kolkata",
              "são paulo": "America/Sao_Paulo", "mexico city": "America/Mexico_City",
              "buenos aires": "America/Argentina/Buenos_Aires", "santiago": "America/Santiago"
            };
            var tz = tzMap[loc] || loc;
            try {
              var time = new Date().toLocaleString("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
              var date = new Date().toLocaleDateString("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric" });
              return "## 🕐 Time in " + args.location + "\n\n**" + time + "**\n" + date + "";
            } catch(e) {
              return "Time unavailable for \"" + args.location + "\". Try a city name or IANA timezone (e.g., 'America/New_York').";
            }
          }
        } catch(e) { return "Error: " + e.message; }
      }

      // convert_time
      if (tn === "convert_time") {
        try {
          var inputTime = (args.time || "").trim().toLowerCase();
          var fromZone = (args.from_zone || "").trim();
          var toZone = (args.to_zone || "").trim();
          if (!inputTime || !fromZone || !toZone) return "Please provide a time, source timezone, and target timezone.";

          if (inputTime === "now") {
            var now = new Date();
            var timeStr = now.toISOString();
            var fromTz = fromZone;
            var toTz = toZone;
            var fromTime = now.toLocaleString("en-US", { timeZone: fromTz, hour: "2-digit", minute: "2-digit", hour12: true });
            var toTime = now.toLocaleString("en-US", { timeZone: toTz, hour: "2-digit", minute: "2-digit", hour12: true });
            var fromDate = now.toLocaleDateString("en-US", { timeZone: fromTz, weekday: "short", month: "short", day: "numeric" });
            var toDate = now.toLocaleDateString("en-US", { timeZone: toTz, weekday: "short", month: "short", day: "numeric" });
            return "## 🔄 Time Conversion\n\n**Now** in **" + fromZone + "**: " + fromTime + " (" + fromDate + ")\n**Now** in **" + toZone + "**: " + toTime + " (" + toDate + ")";
          } else {
            return "⏰ Convert \"" + inputTime + "\" from " + fromZone + " to " + toZone + "\n\nFor precise time conversion, please use 'now' or provide a specific time like '3:00 PM'.\n\n*Tip: Timezone conversion uses IANA timezone names like 'America/New_York' or 'Europe/London'.*";
          }
        } catch(e) { return "Conversion error: " + e.message; }
      }
      return null;
    }
  });
})(ModuleSystem);