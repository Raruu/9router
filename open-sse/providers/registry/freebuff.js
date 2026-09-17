// Freebuff (https://freebuff.com) — ad-supported free tier of the Codebuff
// coding agent, plus paid Codebuff subscriptions. Login is an unofficial CLI
// device flow (freebuff.com / codebuff.com, see src/lib/oauth/providers/freebuff.js);
// inference is proxied through Codebuff's /api/v1 agent surface by
// open-sse/executors/freebuff.js (session + agent-run leasing, queue handling).
// Not officially licensed for router/proxy use → RISK_NOTICE.
export default {
  id: "freebuff",
  alias: "fb",
  uiAlias: "fb",
  priority: 60,
  hasFree: true,
  display: {
    name: "Freebuff",
    icon: "smart_toy",
    color: "#10B981",
    textIcon: "FB",
    website: "https://freebuff.com",
    notice: {
      signupUrl: "https://freebuff.com",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://www.codebuff.com/api/v1/chat/completions",
    format: "openai",
    headers: {
      "User-Agent": "ai-sdk/openai-compatible/1.0.25/codebuff",
    },
  },
  models: [
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", contextLength: 131072 },
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", contextLength: 131072 },
    { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna", contextLength: 131072 },
    { id: "minimax/minimax-m3", name: "MiniMax M3", contextLength: 131072 },
    { id: "mimo/mimo-v2.5", name: "MiMo v2.5", contextLength: 131072 },
    { id: "z-ai/glm-5.2", name: "GLM 5.2", contextLength: 131072 },
    { id: "crof/kimi-k3-eco", name: "Kimi K3 Eco", contextLength: 131072 },
    { id: "anthropic/claude-fable-5", name: "Claude Fable 5", contextLength: 131072 },
    { id: "meta/muse-spark-1.2-contributor", name: "Meta Muse Spark 1.2 Contributor", contextLength: 131072 },
  ],
};
