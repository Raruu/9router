export default {
  id: "runwayml",
  priority: 80,
  alias: "runwayml",
  aliases: [
    "runway",
  ],
  uiAlias: "runway",
  display: {
    name: "Runway ML",
    icon: "movie",
    color: "#000000",
    textIcon: "RW",
    website: "https://runwayml.com",
    notice: {
      apiKeyUrl: "https://dev.runwayml.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: null,
  models: [
    { id: "gen4_image", name: "Gen-4 Image", params: ["size"], kind: "image" },
    { id: "gen4_image_turbo", name: "Gen-4 Image Turbo", params: ["size"], kind: "image" },
    { id: "gen4_turbo", name: "Gen-4 Turbo", params: ["image", "size"], kind: "video" },
    { id: "gen3a_turbo", name: "Gen-3 Alpha Turbo", params: ["image", "size"], kind: "video" },
  ],
  serviceKinds: ["image", "video"],
  imageConfig: { baseUrl: "https://api.dev.runwayml.com/v1" },
  // Video shares the image base URL: Runway's API is task-based per operation
  // (POST /v1/image_to_video → { id }, GET /v1/tasks/{id}), which the video
  // adapter (handlers/videoProviders/runwayml.js) translates onto the
  // async-job shape /v1/videos clients poll. gen*_turbo are image-to-video, so
  // the body carries `image` — the example card's Video kind exposes it.
  videoConfig: { baseUrl: "https://api.dev.runwayml.com/v1" },
};
