import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { logger } from "./logger.js";

const newrelic = process.env.NEW_RELIC_AGENT_ENABLED === "true" && process.env.NEW_RELIC_LICENSE_KEY
  ? createRequire(import.meta.url)("newrelic")
  : undefined;
const methods = new Set([
  "initialize", "notifications/initialized", "ping", "tools/list", "tools/call",
  "resources/list", "resources/templates/list", "resources/read", "prompts/list", "prompts/get",
  "notifications/cancelled", "notifications/progress",
]);
const paths = new Set([
  "/mcp", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-authorization-server", "/.well-known/openai-apps-challenge",
]);

// Only fixed metadata is recorded: never URLs with queries, headers, IDs, params or results.
export const requestLogging: RequestHandler = (req, res, next) => {
  if (!paths.has(req.path)) return next();
  const started = performance.now();
  const requestId = randomUUID();
  const path = req.path;
  const report = () => {
    const status = res.writableFinished ? res.statusCode : 499;
    const rpcMethod = methods.has(req.body?.method) ? req.body.method : "unknown";
    const record = {
      message: "MCP HTTP request", level: status >= 500 ? "ERROR" : status >= 400 ? "WARN" : "INFO",
      requestId, path, httpMethod: req.method, rpcMethod, status,
      durationMs: Math.round(performance.now() - started),
      errorCode: res.locals.mcpErrorCode ?? (status >= 400 ? `http_${status}` : null),
    };
    logger.info(JSON.stringify(record));
    newrelic?.addCustomAttributes({ "mcp.method": rpcMethod, "mcp.requestId": requestId });
    newrelic?.recordLogEvent({ ...record });
  };
  res.once("finish", report);
  res.once("close", () => { if (!res.writableFinished) report(); });
  next();
};
