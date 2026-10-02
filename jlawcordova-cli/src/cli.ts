import { parseArgs } from "node:util";

export const DEFAULT_URL = "https://jlawcordova-mcp.jlawcordova.workers.dev";
const REQUEST_TIMEOUT_MS = 30_000;

export const EXIT = { ok: 0, refused: 1, usage: 2, auth: 3, network: 4 } as const;

export interface Deps {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  readStdin: () => Promise<string>;
  readKeychainToken: () => Promise<string | undefined>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const USAGE = `Usage:
  accomplishments list [--since YYYY-MM] [--limit N]
  accomplishments add              (a JSON object on stdin)
  accomplishments delete <rkey>

Prints JSON on stdout. Errors are JSON on stderr.
Exit codes: 0 ok, 1 refused or failed, 2 bad usage, 3 not signed in, 4 network.
`;

class Usage extends Error {}

function fail(deps: Deps, code: number, error: string, message: string, extra: Record<string, unknown> = {}): number {
  deps.stderr(`${JSON.stringify({ error, message, ...extra }, null, 2)}\n`);
  return code;
}

interface Request {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: string;
}

/** Turns the arguments into a request, or throws Usage. `add` reads its body here, before anything is sent. */
async function plan(argv: string[], deps: Deps): Promise<Request> {
  const [command, ...rest] = argv;

  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { since: { type: "string" }, limit: { type: "string" } },
    });
  } catch (e) {
    throw new Usage(e instanceof Error ? e.message : "Bad arguments.");
  }
  const { values, positionals } = parsed;
  const takesOptions = command === "list";
  if (!takesOptions && (values.since !== undefined || values.limit !== undefined)) {
    throw new Usage(`${command} doesn't take --since or --limit.`);
  }

  switch (command) {
    case "list": {
      if (positionals.length > 0) throw new Usage("list takes no arguments, only --since and --limit.");
      const query = new URLSearchParams();
      if (values.since !== undefined) query.set("since", values.since);
      if (values.limit !== undefined) query.set("limit", values.limit);
      const qs = query.toString();
      return { method: "GET", path: `/api/accomplishments${qs ? `?${qs}` : ""}` };
    }
    case "add": {
      if (positionals.length > 0) throw new Usage("add takes no arguments; pass a JSON object on stdin.");
      const body = await deps.readStdin();
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        throw new Usage("add reads a JSON object from stdin, and that isn't valid JSON.");
      }
      if (typeof parsedBody !== "object" || parsedBody === null || Array.isArray(parsedBody)) {
        throw new Usage("add reads a JSON object from stdin.");
      }
      return { method: "POST", path: "/api/accomplishments", body };
    }
    case "delete": {
      if (positionals.length !== 1) throw new Usage("delete takes exactly one argument: the rkey.");
      return { method: "DELETE", path: `/api/accomplishments/${encodeURIComponent(positionals[0]!)}` };
    }
    default:
      throw new Usage(command === undefined ? "Missing command." : `Unknown command: ${command}`);
  }
}

async function findToken(deps: Deps): Promise<string | undefined> {
  const fromEnv = deps.env.ACCOMPLISHMENTS_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  return (await deps.readKeychainToken())?.trim() || undefined;
}

const NEEDS_LOGIN = "Run `accomplishments login`.";

export async function run(argv: string[], deps: Deps): Promise<number> {
  let request: Request;
  try {
    request = await plan(argv, deps);
  } catch (e) {
    if (!(e instanceof Usage)) throw e;
    deps.stderr(`${JSON.stringify({ error: "usage", message: e.message }, null, 2)}\n${USAGE}`);
    return EXIT.usage;
  }

  const token = await findToken(deps);
  if (!token) return fail(deps, EXIT.auth, "not_signed_in", `You're not signed in. ${NEEDS_LOGIN}`);

  const origin = (deps.env.ACCOMPLISHMENTS_URL?.trim() || DEFAULT_URL).replace(/\/+$/, "");
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
    return fail(deps, EXIT.network, "network", `Couldn't reach ${new URL(origin).origin}.`);
  }

  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(deps, EXIT.refused, "bad_response", `The server answered HTTP ${res.status} with something that isn't JSON.`);
  }

  if (res.ok) {
    deps.stdout(`${JSON.stringify(body, null, 2)}\n`);
    return EXIT.ok;
  }

  const api = (typeof body === "object" && body !== null ? body : {}) as { error?: unknown; message?: unknown; errors?: unknown };
  const code = typeof api.error === "string" ? api.error : `http_${res.status}`;
  let message = typeof api.message === "string" ? api.message : `The request failed with HTTP ${res.status}.`;
  const extra = api.errors !== undefined ? { errors: api.errors } : {};

  const authFailure = res.status === 401 || res.status === 403 || res.status === 503;
  if (res.status === 401 || res.status === 403) {
    if (!message.includes("accomplishments login")) message = `${message} ${NEEDS_LOGIN}`;
  }
  return fail(deps, authFailure ? EXIT.auth : EXIT.refused, code, message, extra);
}
