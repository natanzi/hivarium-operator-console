import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Vitest config for the Hivarium Operator Console.
 *
 * Mirrors the Vite alias (`@` → `./src`) and uses jsdom so the page
 * components can be exercised with @testing-library/react.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{ts,tsx}", "worker/src/adapters/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
