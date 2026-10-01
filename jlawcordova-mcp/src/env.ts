export interface Env {
  OAUTH_KV: KVNamespace;

  // Secrets
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  BSKY_IDENTIFIER: string;
  BSKY_APP_PASSWORD: string;
  GH_DISPATCH_TOKEN: string;

  // Vars
  ALLOWED_GITHUB_USER_ID: string;
  ALLOWED_GITHUB_LOGIN: string;
  ATPROTO_HANDLE: string;
  PORTFOLIO_REPO: string;
  PUBLIC_URL: string;
}

/** What the OAuth provider stores with a grant and hands back on every MCP request. */
export interface AuthProps extends Record<string, unknown> {
  githubId: number;
  login: string;
}
