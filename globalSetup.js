'use strict';

const fs = require('fs');
const path = require('path');

const AGENT_DIR = path.resolve(__dirname, '.agent');
const SCOUT_DIR = path.join(AGENT_DIR, 'scout');

// Registry starts empty on fresh clone. BasePage auto-registers keys on first
// interaction, so the first test run populates the registry dynamically.
const REGISTRY_DEFAULT = {
  version: '1.0.0',
  selectors: {},
};

const METHOD_INDEX_DEFAULT = {
  version: '1.0.0',
  methods: {
    'BasePage.navigate': {
      class: 'BasePage',
      method: 'navigate',
      signature: 'async navigate(url)',
      description: 'Navigates the page to the given URL',
      source_file: 'src/pages/BasePage.js',
      uses_elements: [],
      returns: 'Promise<void>',
    },
    'BasePage.fill': {
      class: 'BasePage',
      method: 'fill',
      signature: 'async fill(registryKey, locatorFn, value)',
      description: 'Fills an input via ActionEngine with registry tracking',
      source_file: 'src/pages/BasePage.js',
      uses_elements: [],
      returns: 'Promise<void>',
    },
    'BasePage.click': {
      class: 'BasePage',
      method: 'click',
      signature: 'async click(registryKey, locatorFn)',
      description: 'Clicks an element via ActionEngine with registry tracking',
      source_file: 'src/pages/BasePage.js',
      uses_elements: [],
      returns: 'Promise<void>',
    },
    'BasePage.getText': {
      class: 'BasePage',
      method: 'getText',
      signature: 'async getText(registryKey, locatorFn)',
      description: 'Returns text content of an element via ActionEngine',
      source_file: 'src/pages/BasePage.js',
      uses_elements: [],
      returns: 'Promise<string>',
    },
    'LoginPage.goto': {
      class: 'LoginPage',
      method: 'goto',
      signature: 'async goto()',
      description: 'Navigates to the SauceDemo base URL',
      source_file: 'src/pages/Login.page.js',
      uses_elements: [],
      returns: 'Promise<void>',
    },
    'LoginPage.login': {
      class: 'LoginPage',
      method: 'login',
      signature: 'async login(username, password)',
      description: 'Fills username and password then clicks the login button',
      source_file: 'src/pages/Login.page.js',
      uses_elements: ['Login.usernameInput', 'Login.passwordInput', 'Login.loginButton'],
      returns: 'Promise<void>',
    },
    'LoginPage.getErrorMessage': {
      class: 'LoginPage',
      method: 'getErrorMessage',
      signature: 'async getErrorMessage()',
      description: 'Returns the text content of the login error message element',
      source_file: 'src/pages/Login.page.js',
      uses_elements: ['Login.errorMessage'],
      returns: 'Promise<string>',
    },
  },
};

const PENDING_PATCHES_DEFAULT = {
  version: '1.0.0',
  patches: [],
};

module.exports = async function globalSetup() {
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  fs.mkdirSync(SCOUT_DIR, { recursive: true });

  const registryPath = path.join(AGENT_DIR, 'registry.json');
  const methodIndexPath = path.join(AGENT_DIR, 'method_index.json');
  const pendingPatchesPath = path.join(AGENT_DIR, 'pending_patches.json');

  if (!fs.existsSync(registryPath)) {
    fs.writeFileSync(registryPath, JSON.stringify(REGISTRY_DEFAULT, null, 2), 'utf8');
    console.log('[globalSetup] Created .agent/registry.json');
  }
  if (!fs.existsSync(methodIndexPath)) {
    fs.writeFileSync(methodIndexPath, JSON.stringify(METHOD_INDEX_DEFAULT, null, 2), 'utf8');
    console.log('[globalSetup] Created .agent/method_index.json');
  }
  if (!fs.existsSync(pendingPatchesPath)) {
    fs.writeFileSync(pendingPatchesPath, JSON.stringify(PENDING_PATCHES_DEFAULT, null, 2), 'utf8');
    console.log('[globalSetup] Created .agent/pending_patches.json');
  }
};
