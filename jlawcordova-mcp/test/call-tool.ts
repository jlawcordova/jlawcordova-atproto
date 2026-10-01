import { env } from "cloudflare:workers";
import { mcpApiHandler } from "../src/mcp.js";

export const OWNER = { githubId: 21234671, login: "jlawcordova" };

export async function callTool(name: string, args: Record<string, unknown>, props: Record<string, unknown> = OWNER) {
  const req = new Request("https://mcp.test/mcp", {
    method: "POST",
    headers: { host: "mcp.test", "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const res = await mcpApiHandler.fetch(req, env as never, { props } as never);
  const raw = await res.text();
  const data = raw.startsWith("{") ? raw : raw.split("\n").find((l) => l.startsWith("data:"))!.slice(5);
  const message = JSON.parse(data);
  if (message.error) return { isError: true as const, text: String(message.error.message), json: () => message.error };
  const text: string = message.result.content[0].text;
  return { isError: Boolean(message.result.isError), text, json: () => JSON.parse(text) };
}
