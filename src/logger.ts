/**
 * Never pass a bearer token or API key to any of these — wcagc-mcp's one hard security
 * invariant is that it never logs a secret (verified by test/auth.test.ts's log-grep).
 */
export const logger = {
  info: (msg: unknown, ...args: unknown[]) => console.log(msg, ...args),
  warn: (msg: unknown, ...args: unknown[]) => console.warn(msg, ...args),
  error: (msg: unknown, ...args: unknown[]) => console.error(msg, ...args),
  debug: (msg: unknown, ...args: unknown[]) => console.debug(msg, ...args),
};
