// ChatSeed Module: YouTube Video Player
// Drop this file in ./modules/ to add YouTube video embedding capabilities
(function(MS){
  var YT_REGEX = /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  MS.register("youtube", {
    name: "YouTube Video Player",
    description: "Embed and play YouTube videos directly in the chat. Provide a video URL or search term.",
    tools: [{
      type: "function",
      function: {
        name: "watch_youtube",
        description: "Embed a YouTube video by URL or video ID so you can watch it inline.",
        parameters: {
          type: "object",
          properties: {
            video: { type: "string", description: "YouTube video URL, video ID, or search query" }
          },
          required: ["video"]
        }
      }
    }],
    handleToolCall: async function(tn, args) {
      if (tn !== "watch_youtube") return null;
      try {
        var input = (args.video || "").trim();
        if (!input) return "Please provide a YouTube video URL or ID.";
        var videoId = null;
        var match = input.match(YT_REGEX);
        if (match) {
          videoId = match[1];
        } else if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
          videoId = input;
        } else {
          return "Could not extract a YouTube video ID from \"" + input + "\". Try a direct YouTube URL like https://www.youtube.com/watch?v=dQw4w9WgXcQ";
        }
        var embedUrl = "https://www.youtube.com/embed/" + videoId + "?autoplay=0&rel=0";
        return '<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:12px;border:1px solid #374151;background:#000;margin:8px 0">'
          + '<iframe src="' + embedUrl + '" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen loading="lazy"></iframe>'
          + '</div>'
          + '\n\n🎬 **YouTube Video** — ID: `' + videoId + '`\n'
          + '[Open on YouTube](https://www.youtube.com/watch?v=' + videoId + ')';
      } catch(e) { return "YouTube error: " + e.message; }
    }
  });
})(ModuleSystem);