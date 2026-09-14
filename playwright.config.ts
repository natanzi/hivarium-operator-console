import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:4173',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: 'npm run build && CI=1 npx wrangler d1 migrations apply hivarium-operator-console --local --config wrangler.e2e.jsonc && npx wrangler dev --config wrangler.e2e.jsonc --port 4173',
        url: 'http://localhost:4173',
        reuseExistingServer: !process.env.CI,
    },
});
