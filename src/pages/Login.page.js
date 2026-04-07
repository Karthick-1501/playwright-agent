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
    await LoginElements.usernameInput(this.page).fill(username);
    await LoginElements.passwordInput(this.page).fill(password);
    await LoginElements.loginButton(this.page).click();
  }

  async getErrorMessage() {
    return LoginElements.errorMessage(this.page).textContent();
  }
}

module.exports = { LoginPage };
