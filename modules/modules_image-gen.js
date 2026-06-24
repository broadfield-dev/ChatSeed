(function(MS) {
  MS.register("image-gen", {
    name: "Image Generation",
    description: "Generate images from text prompts using Pollinations AI (free).",
    tools: [{
      type: "function",
      function: {
        name: "generate_image",
        description: "Generate an image from a text description using Pollinations AI.",
        parameters: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "Text description of the image to generate" },
            width: { type: "number", description: "Width in pixels (default: 512)", default: 512 },
            height: { type: "number", description: "Height in pixels (default: 512)", default: 512 }
          },
          required: ["prompt"]
        }
      }
    }],
    handleToolCall: async function(tn, args) {
      if (tn !== "generate_image") return null;
      var w = Math.min(Math.max(parseInt(args.width) || 512, 128), 1024);
      var h = Math.min(Math.max(parseInt(args.height) || 512, 128), 1024);
      var url = "https://image.pollinations.ai/prompt/" + encodeURIComponent(args.prompt) + "?width=" + w + "&height=" + h + "&nologo=true";
      return "![" + args.prompt + "](" + url + ")\n\n**Prompt:** " + args.prompt + "\n**Size:** " + w + "×" + h + "\n\n_Generated via Pollinations AI_";
    }
  });
})(ModuleSystem);