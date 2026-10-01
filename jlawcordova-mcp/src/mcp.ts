import { createMcpHandler } from "agents/mcp/server";
import type { AuthProps, Env } from "./env.js";
import { createServer } from "./tools.js";

/** The protected `/mcp` endpoint. Reached only with a valid OAuth token; `ctx.props` is what the callback stored. */
export const mcpApiHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext & { props?: AuthProps }) {
    const handler = createMcpHandler(() => createServer(env), {
      route: "/mcp",
      corsOptions: false,
      allowedHostnames: [new URL(env.PUBLIC_URL).hostname],
      authContext: { props: ctx.props ?? {} },
    });
    return handler(request, env, ctx);
  },
};
