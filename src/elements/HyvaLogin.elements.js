'use strict';

const HyvaLoginElements = {
  emailInput: (page) => page.getByRole('textbox', { name: 'Email Address' }), // [AGENT-GENERATED]
  passwordInput: (page) => page.getByRole('textbox', { name: 'Password' }), // [AGENT-GENERATED]
  signInButton: (page) => page.getByRole('button', { name: 'Sign In' }), // [AGENT-GENERATED]
  errorMessage: (page) => page.locator('[role="alert"]'), // [AGENT-GENERATED: DOM-ONLY]
};

module.exports = { HyvaLoginElements };
