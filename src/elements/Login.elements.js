const LoginElements = {
  usernameInput: (page) => page.locator('[data-test="username"]'), // [AGENT-GENERATED]
  passwordInput: (page) => page.locator('[data-test="password"]'), // [AGENT-GENERATED]
  loginButton: (page) => page.getByRole('button', { name: 'Login' }), // [AGENT-GENERATED]
  errorMessage: (page) => page.locator('[data-test="error"]'), // [AGENT-GENERATED]
};

module.exports = { LoginElements };
