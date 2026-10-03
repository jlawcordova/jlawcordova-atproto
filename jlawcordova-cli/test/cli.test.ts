import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run, type Deps } from "../src/cli.ts";

const TOKEN = "gho_fakeCliTestToken0123456789abcdef";
const KEYCHAIN_TOKEN = "gho_fakeKeychainToken0123456789abc";

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

let server: Server;
let origin: string;
let seen: Seen[];
let reply: { status: number; body: unknown; raw?: string };

beforeEach(async () => {
  seen = [];
  reply = { status: 200, body: { items: [], total: 0, skippedInvalid: 0 } };
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(reply.raw ?? JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
  keychainReads: number;
}

async function cli(argv: string[], opts: { stdin?: string; env?: Record<string, string>; keychain?: string } = {}): Promise<Outcome> {
  let stdout = "";
  let stderr = "";
  let keychainReads = 0;
  const deps: Deps = {
    env: { ACCOMPLISHMENTS_URL: origin, ACCOMPLISHMENTS_TOKEN: TOKEN, ...opts.env },
    fetch,
    readStdin: async () => opts.stdin ?? "",
    readKeychainToken: async () => {
      keychainReads++;
      return opts.keychain;
    },
    storeToken: async () => {},
    platform: "darwin",
    sleep: async () => {},
    openUrl: async () => {},
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
  };
  const code = await run(argv, deps);
  return { code, stdout, stderr, keychainReads };
}

const record = {
  title: "Cut deploy time",
  description: "Rebuilt the CI pipeline.",
  startDate: "2026-01",
};

describe("list", () => {
  it("C1: prints the API body, exits 0, and sends since and limit as given", async () => {
    reply.body = { items: [{ rkey: "3jzfcijpj2z2a" }], total: 1, skippedInvalid: 0 };
    const out = await cli(["list", "--since", "2026-01", "--limit", "5"]);
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual(reply.body);
    expect(out.stderr).toBe("");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("GET");
    expect(seen[0]!.url).toBe("/api/accomplishments?since=2026-01&limit=5");
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("C1: without options there is no query string, and bad values go to the server unchanged", async () => {
    await cli(["list"]);
    expect(seen[0]!.url).toBe("/api/accomplishments");
    reply = { status: 400, body: { error: "bad_request", message: "limit must be a whole number from 1 to 100." } };
    const out = await cli(["list", "--limit", "abc"]);
    expect(seen[1]!.url).toBe("/api/accomplishments?limit=abc");
    expect(out.code).toBe(1);
  });

  it("rejects stray arguments before sending anything", async () => {
    for (const argv of [["list", "extra"], ["list", "--nope"], ["list", "--since"]]) {
      expect((await cli(argv)).code, argv.join(" ")).toBe(2);
    }
    expect(seen).toHaveLength(0);
  });
});

describe("add", () => {
  it("C2: sends stdin as the body unchanged and prints the 201 body", async () => {
    reply = { status: 201, body: { rkey: "3jzfcijpj2z2a", rebuild: "triggered" } };
    const stdin = `{ "title":"Cut deploy time",\n  "description": "Rebuilt the CI pipeline.",  "startDate":"2026-01" }\n`;
    const out = await cli(["add"], { stdin });
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual(reply.body);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.url).toBe("/api/accomplishments");
    expect(seen[0]!.body).toBe(stdin);
    expect(seen[0]!.headers["content-type"]).toBe("application/json");
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("C3: empty stdin or anything but a JSON object exits 2 and sends nothing", async () => {
    for (const stdin of ["", "   \n", "not json", "[1]", "null", '"text"', "42"]) {
      const out = await cli(["add"], { stdin });
      expect(out.code, JSON.stringify(stdin)).toBe(2);
      expect(JSON.parse(out.stderr.slice(0, out.stderr.indexOf("}\n") + 1)).error).toBe("usage");
      expect(out.stdout).toBe("");
    }
    expect((await cli(["add", "extra"], { stdin: JSON.stringify(record) })).code).toBe(2);
    expect(seen).toHaveLength(0);
  });

  it("C4: a 422 prints the error and errors array on stderr, nothing on stdout, and exits 1", async () => {
    const errors = [{ field: "title", message: "must not be empty" }];
    reply = { status: 422, body: { error: "invalid", message: "The record failed validation.", errors } };
    const out = await cli(["add"], { stdin: JSON.stringify({ ...record, title: " " }) });
    expect(out.code).toBe(1);
    expect(out.stdout).toBe("");
    expect(JSON.parse(out.stderr)).toEqual({ error: "invalid", message: "The record failed validation.", errors });
  });
});

describe("update", () => {
  it("update C1: sends stdin unchanged as the PATCH body to the URL-encoded rkey and prints the 200 body", async () => {
    reply = { status: 200, body: { rkey: "a/b?c", updated: ["done"], rebuild: "triggered" } };
    const stdin = `{ "done":true,\n  "startDate": "2026-01" }\n`;
    const out = await cli(["update", "a/b?c"], { stdin });
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual(reply.body);
    expect(out.stderr).toBe("");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("PATCH");
    expect(seen[0]!.url).toBe("/api/accomplishments/a%2Fb%3Fc");
    expect(seen[0]!.body).toBe(stdin);
    expect(seen[0]!.headers["content-type"]).toBe("application/json");
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("update C2: update with no rkey exits 2 and sends nothing", async () => {
    const out = await cli(["update"], { stdin: '{"done":true}' });
    expect(out.code).toBe(2);
    expect(JSON.parse(out.stderr.slice(0, out.stderr.indexOf("}\n") + 1)).error).toBe("usage");
    expect(out.stdout).toBe("");
    expect((await cli(["update", "a", "b"], { stdin: '{"done":true}' })).code).toBe(2);
    expect(seen).toHaveLength(0);
  });

  it("update C2: update with empty stdin or a non-object exits 2 and sends nothing", async () => {
    for (const stdin of ["", "   \n", "not json", "[1]", "null", '"text"', "42"]) {
      const out = await cli(["update", "3jzfcijpj2z2a"], { stdin });
      expect(out.code, JSON.stringify(stdin)).toBe(2);
      expect(JSON.parse(out.stderr.slice(0, out.stderr.indexOf("}\n") + 1)).error).toBe("usage");
      expect(out.stdout).toBe("");
    }
    expect(seen).toHaveLength(0);
  });

  it("update C3: 404, 409 and 422 exit 1 with the error on stderr and nothing on stdout", async () => {
    const errors = [{ field: "icon", message: "must be an emoji" }];
    for (const [status, body] of [
      [404, { error: "not_found", message: "Not found: no accomplishment with rkey x." }],
      [409, { error: "conflict", message: "The record changed while updating. Try again." }],
      [422, { error: "invalid", message: "The record failed validation.", errors }],
    ] as const) {
      reply = { status, body };
      const out = await cli(["update", "x"], { stdin: '{"icon":"x"}' });
      expect(out.code, String(status)).toBe(1);
      expect(out.stdout).toBe("");
      expect(JSON.parse(out.stderr)).toEqual(body);
    }
  });
});

describe("delete", () => {
  it("C5: URL-encodes the rkey, and a 404 exits 1", async () => {
    reply = { status: 404, body: { error: "not_found", message: "Not found: no accomplishment with rkey a/b?c." } };
    const out = await cli(["delete", "a/b?c"]);
    expect(seen[0]!.method).toBe("DELETE");
    expect(seen[0]!.url).toBe("/api/accomplishments/a%2Fb%3Fc");
    expect(out.code).toBe(1);
    expect(JSON.parse(out.stderr).error).toBe("not_found");
  });

  it("prints the API body on success, and needs exactly one rkey", async () => {
    reply.body = { rkey: "3jzfcijpj2z2a", deleted: { title: "x", startDate: "2026-01" }, rebuild: "triggered" };
    const ok = await cli(["delete", "3jzfcijpj2z2a"]);
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.stdout)).toEqual(reply.body);
    seen = [];
    expect((await cli(["delete"])).code).toBe(2);
    expect((await cli(["delete", "a", "b"])).code).toBe(2);
    expect((await cli(["delete", "a", "--limit", "1"])).code).toBe(2);
    expect(seen).toHaveLength(0);
  });
});

describe("failures", () => {
  it("C6: 401 and 403 exit 3 with the login hint; 503 exits 3; other refusals exit 1", async () => {
    for (const [status, error, message] of [
      [401, "unauthorized", "Missing or invalid token."],
      [403, "forbidden", "This GitHub account isn't allowed to use the accomplishments API."],
    ] as const) {
      reply = { status, body: { error, message } };
      const out = await cli(["list"]);
      expect(out.code, String(status)).toBe(3);
      expect(JSON.parse(out.stderr)).toEqual({ error, message: expect.stringContaining("accomplishments login") });
      expect(out.stdout).toBe("");
    }
    reply = { status: 503, body: { error: "auth_unavailable", message: "Couldn't check the token with GitHub. Try again." } };
    expect((await cli(["list"])).code).toBe(3);
    for (const status of [400, 404, 413, 422, 502]) {
      reply = { status, body: { error: "x", message: "m" } };
      expect((await cli(["list"])).code, String(status)).toBe(1);
    }
  });

  it("C6: a connection failure exits 4", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const out = await cli(["list"]);
    expect(out.code).toBe(4);
    expect(JSON.parse(out.stderr).error).toBe("network");
    // Reopen so the shared afterEach can close it again.
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  it("a non-JSON answer exits 1 and a body without an error code still gets one", async () => {
    reply = { status: 200, body: null, raw: "<html>oops</html>" };
    const html = await cli(["list"]);
    expect(html.code).toBe(1);
    expect(JSON.parse(html.stderr).error).toBe("bad_response");

    reply = { status: 500, body: {} };
    const bare = await cli(["list"]);
    expect(bare.code).toBe(1);
    expect(JSON.parse(bare.stderr)).toMatchObject({ error: "http_500" });
  });
});

describe("token lookup", () => {
  it("C7: ACCOMPLISHMENTS_TOKEN wins and the keychain isn't read", async () => {
    const out = await cli(["list"], { keychain: KEYCHAIN_TOKEN });
    expect(out.code).toBe(0);
    expect(out.keychainReads).toBe(0);
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("C7: otherwise the keychain token is used", async () => {
    const out = await cli(["list"], { env: { ACCOMPLISHMENTS_TOKEN: "  " }, keychain: `${KEYCHAIN_TOKEN}\n` });
    expect(out.code).toBe(0);
    expect(out.keychainReads).toBe(1);
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${KEYCHAIN_TOKEN}`);
  });

  it("C7: with neither, exit 3 and no request", async () => {
    const out = await cli(["list"], { env: { ACCOMPLISHMENTS_TOKEN: "" } });
    expect(out.code).toBe(3);
    expect(JSON.parse(out.stderr)).toEqual({ error: "not_signed_in", message: expect.stringContaining("accomplishments login") });
    expect(seen).toHaveLength(0);
  });
});

describe("usage", () => {
  it("update C4: usage text lists update, and --help still exits 2", async () => {
    const out = await cli(["--help"]);
    expect(out.code).toBe(2);
    expect(out.stderr).toContain("accomplishments update <rkey>");
    expect(out.stdout).toBe("");
    expect(seen).toHaveLength(0);
  });

  it("C12: an unknown command, no command, or --help prints usage to stderr and exits 2", async () => {
    for (const argv of [[], ["nope"], ["--help"], ["help"]]) {
      const out = await cli(argv);
      expect(out.code, argv.join(" ")).toBe(2);
      expect(out.stderr).toContain("Usage:");
      expect(out.stdout).toBe("");
    }
    expect(seen).toHaveLength(0);
  });
});

describe("secrets", () => {
  it("C11: the token is in no stdout or stderr, on any path", async () => {
    const outputs: Outcome[] = [];
    outputs.push(await cli(["list"]));
    outputs.push(await cli(["add"], { stdin: JSON.stringify(record) }));
    outputs.push(await cli(["update", "3jzfcijpj2z2a"], { stdin: '{"done":true}' }));
    outputs.push(await cli(["delete", "3jzfcijpj2z2a"]));
    outputs.push(await cli(["add"], { stdin: "nope" }));
    outputs.push(await cli(["nope"]));
    for (const [status, error] of [[401, "unauthorized"], [403, "forbidden"], [422, "invalid"], [503, "auth_unavailable"]] as const) {
      reply = { status, body: { error, message: "m", errors: [] } };
      outputs.push(await cli(["list"], { keychain: KEYCHAIN_TOKEN }));
    }
    reply = { status: 200, body: null, raw: "<html>" };
    outputs.push(await cli(["list"]));
    outputs.push(await cli(["list"], { env: { ACCOMPLISHMENTS_URL: "http://127.0.0.1:1" } }));
    for (const out of outputs) {
      for (const token of [TOKEN, KEYCHAIN_TOKEN]) {
        expect(out.stdout).not.toContain(token);
        expect(out.stderr).not.toContain(token);
      }
    }
  });
});
