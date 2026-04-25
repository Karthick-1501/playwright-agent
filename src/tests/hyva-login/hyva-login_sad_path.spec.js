'use strict';

const { test, expect } = require('@playwright/test');
const { HyvaLoginPage } = require('../../pages/HyvaLogin.page');
const { TestData } = require('../../../config/testdata.config');

test.describe('Hyva Login - Sad Path', () => {
  test('invalid credentials shows error', async ({ page }) => {
    const loginPage = new HyvaLoginPage(page);
    const credentials = TestData.get('hyva_login.invalid_user');

    await loginPage.goto();
    await loginPage.login(credentials.email, credentials.password);

    // Wait for the error message to appear and verify it
    const errorMessage = await loginPage.getErrorMessage();
    expect(errorMessage).toBeTruthy();
  });
});
