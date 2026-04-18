'use strict';

const { BasePage } = require('./BasePage');
const { LoginElements } = require('../elements/Login.elements');
const { baseUrl } = require('../../config/execution.config');

class LoginPage extends BasePage {
  constructor(page) {
    super(page);
  }

  async goto() {
    await this.navigate(baseUrl);
  }

  async login(username, password) {
    await this.fill('Login.usernameInput', LoginElements.usernameInput, username);
    await this.fill('Login.passwordInput', LoginElements.passwordInput, password);
    await this.click('Login.loginButton', LoginElements.loginButton);
  }

  async getErrorMessage() {
    return this.getText('Login.errorMessage', LoginElements.errorMessage);
  }
}

module.exports = { LoginPage };
