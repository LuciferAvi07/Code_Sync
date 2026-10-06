const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/browser',
    workers: 1,
    timeout: 60000,
    expect: { timeout: 10000 },
    use: {
        baseURL: 'http://127.0.0.1:5100',
        viewport: { width: 1440, height: 900 },
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    },
    webServer: {
        command: 'node server.js',
        url: 'http://127.0.0.1:5100',
        reuseExistingServer: false,
        env: { PORT: '5100', DATABASE_PATH: ':memory:', JWT_SECRET: 'isolated-browser-regression-secret' },
    },
});
