const { defineConfig } = require('@playwright/test');
const { baseUrl } = require('./config/execution.config');

module.exports = defineConfig({
  testDir: './src/tests',
  use: {
    baseURL: baseUrl,
    headless: false,
  },
  reporter: 'list',
});
