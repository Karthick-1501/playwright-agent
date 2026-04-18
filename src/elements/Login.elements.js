'use strict';

const LoginElements = {
  usernameInput: (page) => page.locator('[data-test="username"]'), // [REGISTRY-HEALED v1]
  passwordInput: (page) => page.locator('[data-test="password"]'), // [REGISTRY-HEALED v1]
  loginButton: (page) => page.locator('[data-test="login-button"]'), // [REGISTRY-HEALED v1]
  errorMessage: (page) => page.locator('[data-test="error"]'), // [SCOUT-GENERATED]
};

module.exports = { LoginElements };
