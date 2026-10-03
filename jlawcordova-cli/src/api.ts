const REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_URL = "https://jlawcordova-mcp.jlawcordova.workers.dev";

export const EXIT = { ok: 0, refused: 1, usage: 2, auth: 3, network: 4 } as const;

export interface Deps {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  readStdin: () => Promise<string>;
  readKeychainToken: () => Promise<string | undefined>;
  /** Saves the token to the keychain; throws if it couldn't be saved. */
  storeToken: (token: string) => Promise<void>;
  platform: string;
  sleep: (ms: number) => Promise<void>;
  /** Tries to open a page in the browser. Failure is not an error. */
  openUrl: (url: string) => Promise<void>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export function fail(deps: Deps, code: number, error: string, message: string, extra: Record<string, unknown> = {}): number {
  deps.stderr(`${JSON.stringify({ error, message, ...extra }, null, 2)}\n`);
  return code;
}

export interface Request {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: string;
}

export async function findToken(deps: Deps): Promise<string | undefined> {
  const fromEnv = deps.env.ACCOMPLISHMENTS_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  return (await deps.readKeychainToken())?.trim() || undefined;
}

export const NEEDS_LOGIN = "Run `accomplishments login`.";

export function workerOrigin(deps: Deps): string {
  return (deps.env.ACCOMPLISHMENTS_URL?.trim() || DEFAULT_URL).replace(/\/+$/, "");
}

export type ApiOutcome =
  | { ok: true; body: unknown }
  | { ok: false; code: number; status?: number; error: string; message: string; extra: Record<string, unknown> };

/** Sends one request to the Worker and sorts the answer into success or a failure with its exit code. */
export async function callApi(deps: Deps, token: string, request: Request): Promise<ApiOutcome> {
  const origin = workerOrigin(deps);
  let res: Response;
  try {
    res = await deps.fetch(`${origin}${request.path}`, {
      method: request.method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(request.body !== undefined && { "content-type": "application/json" }),
      },
      ...(request.body !== undefined && { body: request.body }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, code: EXIT.network, error: "network", message: `Couldn't reach ${new URL(origin).origin}.`, extra: {} };
  }

  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return {
      ok: false,
      code: EXIT.refused,
      status: res.status,
      error: "bad_response",
      message: `The server answered HTTP ${res.status} with something that isn't JSON.`,
      extra: {},
    };
  }
  if (res.ok) return { ok: true, body };

  const api = (typeof body === "object" && body !== null ? body : {}) as { error?: unknown; message?: unknown; errors?: unknown };
  let message = typeof api.message === "string" ? api.message : `The request failed with HTTP ${res.status}.`;
  if ((res.status === 401 || res.status === 403) && !message.includes("accomplishments login")) {
    message = `${message} ${NEEDS_LOGIN}`;
  }
  const authFailure = res.status === 401 || res.status === 403 || res.status === 503;
  return {
    ok: false,
    code: authFailure ? EXIT.auth : EXIT.refused,
    status: res.status,
    error: typeof api.error === "string" ? api.error : `http_${res.status}`,
    message,
    extra: api.errors !== undefined ? { errors: api.errors } : {},
  };
}

export function report(deps: Deps, outcome: Extract<ApiOutcome, { ok: false }>): number {
  return fail(deps, outcome.code, outcome.error, outcome.message, outcome.extra);
}

