import path from "node:path";
import { fileURLToPath } from "node:url";

import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const workerRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vitest project for the Cloudflare Worker API and D1 bindings.
 *
 * Runs inside the Workers runtime (workerd) so tests exercise the real
 * `crypto.subtle` JWT verification and a real D1 binding from
 * `wrangler.jsonc`.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // The bundled workerd binary in this container supports dates up to
      // 2026-08-22; pin the test runtime so local runs do not depend on the
      // deployment compatibility date.
      miniflare: { compatibilityDate: "2026-08-22" },
    }),
  ],
  resolve: {
    alias: {
      // The Worker bundle resolves the SPA's "@/*" alias through the
      // wrangler.jsonc `alias` block, but the vitest-pool-workers runner
      // resolves test imports through Vite's module fallback service, so the
      // alias must be declared here too (D-07 shared pure rules).
      "@": path.join(workerRoot, "src"),
    },
  },
  test: {
    include: ["worker/**/*.{test,spec}.ts"],
  },
});
