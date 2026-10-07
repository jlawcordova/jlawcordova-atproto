import { parseArgs } from "node:util";
import { callApi, EXIT, fail, findToken, NEEDS_LOGIN, report, type Deps, type Request } from "./api.ts";
import { login } from "./login.ts";
import pkg from "../package.json" with { type: "json" };

export type { Deps } from "./api.ts";

const USAGE = `Usage:
  accomplishments list [--since YYYY-MM] [--limit N]
  accomplishments add              (a JSON object on stdin)
  accomplishments update <rkey>    (a JSON patch object on stdin)
  accomplishments delete <rkey>
  accomplishments login            (sign in with GitHub; once per machine)
  accomplishments --version

Prints JSON on stdout. Errors are JSON on stderr.
Exit codes: 0 ok, 1 refused or failed, 2 bad usage, 3 not signed in, 4 network.
`;

class Usage extends Error {}

/** Turns the arguments into a request, or throws Usage. `add` and `update` read their body here, before anything is sent. */
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
    case "update": {
      if (positionals.length !== 1) throw new Usage("update takes exactly one argument: the rkey.");
      const body = await deps.readStdin();
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        throw new Usage("update reads a JSON object from stdin, and that isn't valid JSON.");
      }
      if (typeof parsedBody !== "object" || parsedBody === null || Array.isArray(parsedBody)) {
        throw new Usage("update reads a JSON object from stdin.");
      }
      return { method: "PATCH", path: `/api/accomplishments/${encodeURIComponent(positionals[0]!)}`, body };
    }
    case "delete": {
      if (positionals.length !== 1) throw new Usage("delete takes exactly one argument: the rkey.");
      return { method: "DELETE", path: `/api/accomplishments/${encodeURIComponent(positionals[0]!)}` };
    }
    default:
      throw new Usage(command === undefined ? "Missing command." : `Unknown command: ${command}`);
  }
}


export async function run(argv: string[], deps: Deps): Promise<number> {
  if (argv[0] === "--version") {
    if (argv.length > 1) {
      deps.stderr(`${JSON.stringify({ error: "usage", message: "--version takes no arguments." }, null, 2)}\n${USAGE}`);
      return EXIT.usage;
    }
    deps.stdout(`${JSON.stringify({ version: pkg.version }, null, 2)}\n`);
    return EXIT.ok;
  }

  if (argv[0] === "login") {
    if (argv.length > 1) {
      deps.stderr(`${JSON.stringify({ error: "usage", message: "login takes no arguments." }, null, 2)}\n${USAGE}`);
      return EXIT.usage;
    }
    return login(deps);
  }

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

  const outcome = await callApi(deps, token, request);
  if (!outcome.ok) return report(deps, outcome);
  deps.stdout(`${JSON.stringify(outcome.body, null, 2)}\n`);
  return EXIT.ok;
}
