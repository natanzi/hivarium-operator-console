import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:4173',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        // Instead of using bundled chromium which lacks libs in this sandbox,
        // we instruct playwright to try using the system-installed chrome/chromium.
        channel: 'chromium',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: 'npm run build && npx vite preview --port 4173',
        url: 'http://localhost:4173',
        reuseExistingServer: !process.env.CI,
    },
});
