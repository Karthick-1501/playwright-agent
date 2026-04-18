'use strict';

const { defineConfig } = require('@playwright/test');
const { baseUrl } = require('./config/execution.config');

module.exports = defineConfig({
  testDir: './src/tests',
  globalSetup: './globalSetup',
  use: {
    baseURL: baseUrl,
    headless: process.env.CI === 'true' || process.env.HEADLESS === 'true',
  },
  reporter: process.env.CI === 'true' ? [['github'], ['html', { open: 'never' }]] : 'list',
});
