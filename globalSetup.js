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
      class: 'BasePage', method: 'navigate',
      signature: 'async navigate(url)',
      description: 'Navigates the page to the given URL',
      source_file: 'src/pages/BasePage.js',
      uses_elements: [], returns: 'Promise<void>',
    },
    'BasePage.fill': {
      class: 'BasePage', method: 'fill',
      signature: 'async fill(registryKey, locatorFn, value)',
      description: 'Fills an input via ActionEngine with registry tracking',
      source_file: 'src/pages/BasePage.js',
      uses_elements: [], returns: 'Promise<void>',
    },
    'BasePage.click': {
      class: 'BasePage', method: 'click',
      signature: 'async click(registryKey, locatorFn)',
      description: 'Clicks an element via ActionEngine with registry tracking',
      source_file: 'src/pages/BasePage.js',
      uses_elements: [], returns: 'Promise<void>',
    },
    'BasePage.selectOption': {
      class: 'BasePage', method: 'selectOption',
      signature: 'async selectOption(registryKey, locatorFn, value)',
      description: 'Selects a combobox option via ActionEngine with registry tracking',
      source_file: 'src/pages/BasePage.js',
      uses_elements: [], returns: 'Promise<void>',
    },
    'BasePage.getText': {
      class: 'BasePage', method: 'getText',
      signature: 'async getText(registryKey, locatorFn)',
      description: 'Returns text content of an element via ActionEngine',
      source_file: 'src/pages/BasePage.js',
      uses_elements: [], returns: 'Promise<string>',
    },
    'BasePage.isVisible': {
      class: 'BasePage', method: 'isVisible',
      signature: 'async isVisible(registryKey, locatorFn)',
      description: 'Returns boolean visibility of an element via ActionEngine',
      source_file: 'src/pages/BasePage.js',
      uses_elements: [], returns: 'Promise<boolean>',
    },
    'BasePage.assertVisible': {
      class: 'BasePage', method: 'assertVisible',
      signature: 'async assertVisible(registryKey, locatorFn)',
      description: 'Asserts an element is visible via AssertEngine',
      source_file: 'src/pages/BasePage.js',
      uses_elements: [], returns: 'Promise<void>',
    },
    'BasePage.assertText': {
      class: 'BasePage', method: 'assertText',
      signature: 'async assertText(registryKey, locatorFn, expected)',
      description: 'Asserts an element has the expected text via AssertEngine',
      source_file: 'src/pages/BasePage.js',
      uses_elements: [], returns: 'Promise<void>',
    },
    'HyvaLoginPage.goto': {
      class: 'HyvaLoginPage', method: 'goto',
      signature: 'async goto()',
      description: 'Navigates to the Hyva login page',
      source_file: 'src/pages/HyvaLogin.page.js',
      uses_elements: [], returns: 'Promise<void>',
    },
    'HyvaLoginPage.login': {
      class: 'HyvaLoginPage', method: 'login',
      signature: 'async login(email, password)',
      description: 'Fills email and password then clicks Sign In',
      source_file: 'src/pages/HyvaLogin.page.js',
      uses_elements: ['HyvaLogin.emailInput', 'HyvaLogin.passwordInput', 'HyvaLogin.signInButton'],
      returns: 'Promise<void>',
    },
    'HyvaLoginPage.getErrorMessage': {
      class: 'HyvaLoginPage', method: 'getErrorMessage',
      signature: 'async getErrorMessage()',
      description: 'Returns text content of the login error message element',
      source_file: 'src/pages/HyvaLogin.page.js',
      uses_elements: ['HyvaLogin.errorMessage'],
      returns: 'Promise<string>',
    },
    'HyvaHomePage.navigate': {
      class: 'HyvaHomePage', method: 'navigate',
      signature: 'async navigate(url)',
      description: 'Navigates to the given URL',
      source_file: 'src/pages/HyvaHome.page.js',
      uses_elements: [], returns: 'Promise<void>',
    },
    'HyvaHomePage.addLandoGymJacketToCart': {
      class: 'HyvaHomePage', method: 'addLandoGymJacketToCart',
      signature: 'async addLandoGymJacketToCart()',
      description: 'Hovers Lando Gym Jacket card, selects XL size, Blue color, clicks Add to Cart',
      source_file: 'src/pages/HyvaHome.page.js',
      uses_elements: ['HyvaHome.landoGymJacket', 'HyvaHome.landoSizeXL', 'HyvaHome.landoColorBlue', 'HyvaHome.addToCartLandoGymJacket'],
      returns: 'Promise<void>',
    },
    'HyvaHomePage.addIngridRunningJacketToCart': {
      class: 'HyvaHomePage', method: 'addIngridRunningJacketToCart',
      signature: 'async addIngridRunningJacketToCart()',
      description: 'Hovers Ingrid Running Jacket card, selects XS size, Blue color, clicks Add to Cart',
      source_file: 'src/pages/HyvaHome.page.js',
      uses_elements: ['HyvaHome.ingridRunningJacket', 'HyvaHome.ingridSizeXS', 'HyvaHome.ingridColorBlue', 'HyvaHome.addToCartIngridRunningJacket'],
      returns: 'Promise<void>',
    },
    'HyvaHomePage.openMinicart': {
      class: 'HyvaHomePage', method: 'openMinicart',
      signature: 'async openMinicart()',
      description: 'Clicks the minicart toggle button to open the minicart drawer',
      source_file: 'src/pages/HyvaHome.page.js',
      uses_elements: ['HyvaHome.toggleMinicartCartIsEmpty'],
      returns: 'Promise<void>',
    },
    'HyvaHomePage.assertMinicartSubtotalVisible': {
      class: 'HyvaHomePage', method: 'assertMinicartSubtotalVisible',
      signature: 'async assertMinicartSubtotalVisible()',
      description: 'Asserts the minicart subtotal element is visible',
      source_file: 'src/pages/HyvaHome.page.js',
      uses_elements: ['HyvaHome.minicartSubtotal'],
      returns: 'Promise<void>',
    },
    'HyvaHomePage.clickMinicartCheckout': {
      class: 'HyvaHomePage', method: 'clickMinicartCheckout',
      signature: 'async clickMinicartCheckout()',
      description: 'Clicks the Proceed to Checkout link in the minicart',
      source_file: 'src/pages/HyvaHome.page.js',
      uses_elements: ['HyvaHome.minicartCheckoutButton'],
      returns: 'Promise<void>',
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
