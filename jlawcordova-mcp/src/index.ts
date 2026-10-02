import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { handleApi } from "./api.js";
import type { Env } from "./env.js";
import { githubHandler } from "./github-handler.js";
import { mcpApiHandler } from "./mcp.js";

let cached: { url: string; provider: OAuthProvider<Env> } | undefined;

/**
 * The provider needs the Worker's canonical public URL, which is only known
 * once deployed, so it is built from `PUBLIC_URL` on first use.
 */
function providerFor(env: Env): OAuthProvider<Env> {
  const origin = env.PUBLIC_URL.replace(/\/+$/, "");
  if (cached?.url === origin) return cached.provider;
  const provider = new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: mcpApiHandler as never,
    defaultHandler: githubHandler as never,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    resourceMetadata: {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      resource_name: "jlawcordova-mcp",
    },
  });
  cached = { url: origin, provider };
  return provider;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // The CLI's HTTP API has its own token check; it never goes through the OAuth provider.
    if (new URL(request.url).pathname.startsWith("/api/")) return handleApi(request, env);
    return providerFor(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
