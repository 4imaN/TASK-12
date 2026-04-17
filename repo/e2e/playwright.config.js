module.exports = {
  testDir: '.',
  testMatch: '*.e2e.js',
  timeout: 30000,
  use: {
    baseURL: process.env.BASE_URL || 'https://localhost:8443',
    ignoreHTTPSErrors: true,
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
    }
  }
};
