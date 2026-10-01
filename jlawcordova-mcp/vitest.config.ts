import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Fake values: nothing in the tests talks to a real service.
        bindings: {
          GITHUB_CLIENT_ID: "test-github-client-id",
          GITHUB_CLIENT_SECRET: "test-github-client-secret-SECRET",
          BSKY_IDENTIFIER: "jlawcordova.com",
          BSKY_APP_PASSWORD: "test-app-password-SECRET",
          GH_DISPATCH_TOKEN: "test-dispatch-token-SECRET",
          PUBLIC_URL: "https://mcp.test",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    // The first request to the Worker loads and transforms its whole module graph.
    testTimeout: 60_000,
  },
});
