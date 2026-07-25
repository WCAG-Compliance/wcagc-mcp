import { config } from "./config.js";

/**
 * A wcagc-api RFC 7807 ProblemDetail, mapped 1:1 (GlobalExceptionHandler always sets `code`;
 * BusinessException extensions like `targetPlan`/`limit`/`retryAfter` land as flat top-level
 * properties, never nested).
 */
export class McpApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly targetPlan?: string,
    public readonly limit?: number,
    /** Set on API_KEY_SCOPE_MISSING — the scope the key would have needed. */
    public readonly requiredScope?: string,
  ) {
    super(message);
    this.name = "McpApiError";
  }

  /** Only present for a paywall denial (FEATURE_NOT_IN_PLAN / PLAN_LIMIT_EXCEEDED). */
  upgradeUrl(): string | undefined {
    return this.targetPlan ? `${config.pricingUrl}?plan=${encodeURIComponent(this.targetPlan)}` : undefined;
  }
}

async function toApiError(res: Response): Promise<McpApiError> {
  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    // non-JSON error body (e.g. an upstream proxy 502) — fall through with a generic code
  }
  const code = typeof body.code === "string" ? body.code : "INTERNAL_ERROR";
  const message = typeof body.detail === "string" ? body.detail : `Request failed with status ${res.status}`;
  const targetPlan = typeof body.targetPlan === "string" ? body.targetPlan : undefined;
  const limit = typeof body.limit === "number" ? body.limit : undefined;
  const requiredScope = typeof body.requiredScope === "string" ? body.requiredScope : undefined;
  return new McpApiError(res.status, code, message, targetPlan, limit, requiredScope);
}

/** Never logs `bearer` — callers must not either. */
export async function apiFetch(bearer: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${bearer}`);
  const res = await fetch(new URL(path, config.apiBaseUrl), {
    ...init,
    headers,
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return res;
}

export async function apiJson<T>(bearer: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await apiFetch(bearer, path, { ...init, headers });
  return (await res.json()) as T;
}
