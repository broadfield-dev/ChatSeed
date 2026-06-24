// ChatSeed Module: Weather
// Drop this file in ./modules/ to add weather capabilities
(function(MS){
  MS.register("weather", {
    name: "Weather",
    description: "Get current weather and forecasts for any location worldwide using wttr.in (free).",
    tools: [{
      type: "function",
      function: {
        name: "get_weather",
        description: "Get current weather and forecast for any location. Supports city names, zip codes, airport codes.",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string", description: "City name, zip code, or lat/lon" },
            forecast_days: { type: "number", description: "Forecast days (0-5)", default: 3 }
          },
          required: ["location"]
        }
      }
    }],
    handleToolCall: async function(tn, args) {
      if (tn !== "get_weather") return null;
      try {
        var r = await fetch("https://wttr.in/" + encodeURIComponent(args.location) + "?format=j1");
        if (!r.ok) throw Error("HTTP " + r.status);
        var d = await r.json();
        var c = d.nearest_area && d.nearest_area[0]
          ? d.nearest_area[0].areaName[0].value + ", " + d.nearest_area[0].country[0].value
          : args.location;
        var l = ["Location: " + c, ""];
        var cur = d.current_condition && d.current_condition[0];
        if (cur) {
          l.push("### Current Conditions");
          l.push((cur.weatherDesc && cur.weatherDesc[0] ? cur.weatherDesc[0].value : "?") +
            " -- " + cur.temp_C + "C (" + cur.temp_F + "F)");
          l.push("Humidity: " + cur.humidity + "% | Wind: " + cur.windspeedKmph + " km/h");
        }
        var days = Math.min(Math.max(parseInt(args.forecast_days) || 3, 0), 5);
        if (d.weather && d.weather.length > 1 && days > 0) {
          l.push("### " + days + "-Day Forecast");
          for (var i = 1; i <= Math.min(d.weather.length - 1, days); i++) {
            var w = d.weather[i];
            l.push(w.date + ": " + w.maxtempC + "C / " + w.mintempC + "C");
          }
        }
        return l.join("\n");
      } catch (e) {
        return "Weather unavailable: " + e.message;
      }
    }
  });
})(ModuleSystem);