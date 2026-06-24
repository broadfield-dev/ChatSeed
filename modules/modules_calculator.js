(function(MS) {
  MS.register("calculator", {
    name: "Calculator",
    description: "Precise calculations: arithmetic, trig, logarithms, unit conversions (km⇔miles, C⇔F, kg⇔lbs, etc.)",
    tools: [{
      type: "function",
      function: {
        name: "calculate",
        description: "Evaluate a math expression. Supports +, -, *, /, ^, sin, cos, tan, sqrt, log, ln, abs, pi, and unit conversions like '100 km to miles', '32 C to F', '5 kg to lbs'.",
        parameters: {
          type: "object",
          properties: { expression: { type: "string", description: "Math expression to evaluate" } },
          required: ["expression"]
        }
      }
    }],
    handleToolCall: async function(tn, args) {
      if (tn !== "calculate") return null;
      try {
        var e = args.expression.trim();

        // Unit conversions
        var uc = {
          "km to miles": function(v) { return v * 0.621371; },
          "miles to km": function(v) { return v / 0.621371; },
          "c to f": function(v) { return v * 9/5 + 32; },
          "f to c": function(v) { return (v - 32) * 5/9; },
          "kg to lbs": function(v) { return v * 2.20462; },
          "lbs to kg": function(v) { return v / 2.20462; },
          "meters to feet": function(v) { return v * 3.28084; },
          "feet to meters": function(v) { return v / 3.28084; },
          "inches to cm": function(v) { return v * 2.54; },
          "cm to inches": function(v) { return v / 2.54; },
          "liters to gallons": function(v) { return v * 0.264172; },
          "gallons to liters": function(v) { return v / 0.264172; }
        };

        for (var key in uc) {
          var idx = e.toLowerCase().indexOf(" " + key);
          if (idx === -1) idx = e.toLowerCase().indexOf(key);
          if (idx > -1) {
            var numStr = e.substring(0, idx).trim();
            var num = parseFloat(numStr);
            if (!isNaN(num)) {
              var result = uc[key](num);
              var rounded = Math.round(result * 10000) / 10000;
              return e + " = " + rounded + " (" + key + ")";
            }
          }
        }

        // Math evaluation
        var p = e.replace(/\^/g, "**")
                 .replace(/\bpi\b/gi, "(" + Math.PI + ")")
                 .replace(/\be\b(?!\w)/g, "(" + Math.E + ")")
                 .replace(/\bsin\(/g, "Math.sin(")
                 .replace(/\bcos\(/g, "Math.cos(")
                 .replace(/\btan\(/g, "Math.tan(")
                 .replace(/\basin\(/g, "Math.asin(")
                 .replace(/\bacos\(/g, "Math.acos(")
                 .replace(/\batan\(/g, "Math.atan(")
                 .replace(/\bsqrt\(/g, "Math.sqrt(")
                 .replace(/\blog\(/g, "Math.log10(")
                 .replace(/\bln\(/g, "Math.log(")
                 .replace(/\babs\(/g, "Math.abs(")
                 .replace(/\bround\(/g, "Math.round(")
                 .replace(/\bfloor\(/g, "Math.floor(")
                 .replace(/\bceil\(/g, "Math.ceil(");
        var result = Function('"use strict"; return (' + p + ')')();
        var rounded = Math.round(result * 1000000) / 1000000;
        return e + " = " + rounded;
      } catch (ex) { return "Error: " + ex.message; }
    }
  });
})(ModuleSystem);