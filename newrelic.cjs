exports.config = {
  app_name: [process.env.NEW_RELIC_APP_NAME || "wcagc-mcp"],
  license_key: process.env.NEW_RELIC_LICENSE_KEY,
  agent_enabled: process.env.NEW_RELIC_AGENT_ENABLED === "true" && !!process.env.NEW_RELIC_LICENSE_KEY,
  logging: { level: "warn", filepath: "stdout" },
  allow_all_headers: false,
  ignore_server_configuration: true,
  strip_exception_messages: { enabled: true },
  attributes: { exclude: ["request.*", "response.*", "http.*", "url", "url.*", "user.*"] },
  rules: { ignore: ["^/health$"] },
  application_logging: { forwarding: { enabled: true, max_samples_stored: 1000 } },
};
