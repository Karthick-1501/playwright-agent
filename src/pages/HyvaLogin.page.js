'use strict';

const { BasePage } = require('./BasePage');
const { HyvaLoginElements } = require('../elements/HyvaLogin.elements');
const { baseUrl } = require('../../config/execution.config');

class HyvaLoginPage extends BasePage {
  constructor(page) {
    super(page);
  }

  async goto() {
    await this.navigate(`${baseUrl}/customer/account/login/`);
  }

  async login(email, password) {
    await this.fill('HyvaLogin.emailInput', HyvaLoginElements.emailInput, email);
    await this.fill('HyvaLogin.passwordInput', HyvaLoginElements.passwordInput, password);
    await this.click('HyvaLogin.signInButton', HyvaLoginElements.signInButton);
  }

  async getErrorMessage() {
    return this.getText('HyvaLogin.errorMessage', HyvaLoginElements.errorMessage);
  }
}

module.exports = { HyvaLoginPage };
