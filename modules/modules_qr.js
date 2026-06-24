(function(MS) {
  MS.register("qr-tools", {
    name: "QR Code Generator",
    description: "Generate QR codes for URLs, text, contact info, WiFi credentials, and more.",
    tools: [{
      type: "function",
      function: {
        name: "generate_qr",
        description: "Generate a QR code image for any data (URL, text, phone number, etc.).",
        parameters: {
          type: "object",
          properties: {
            data: { type: "string", description: "Data to encode (URL, text, phone, etc.)" },
            size: { type: "number", description: "Image size in pixels (100-500)", default: 250 },
            label: { type: "string", description: "Optional descriptive label" }
          },
          required: ["data"]
        }
      }
    }],
    handleToolCall: async function(tn, args) {
      console.log("calling qr")
      if (tn !== "generate_qr") return null;
      var size = Math.min(Math.max(parseInt(args.size) || 250, 100), 500);
      var url = "https://api.qrserver.com/v1/create-qr-code/?size=" + size + "x" + size + "&data=" + encodeURIComponent(args.data);
      var result = "![QR Code](" + url + ")\n\n**QR Code** for: " + (args.label || args.data) + "\nSize: " + size + "×" + size + "px\n\n_Scan with any QR reader._";
      return result;
    }
  });
})(ModuleSystem);