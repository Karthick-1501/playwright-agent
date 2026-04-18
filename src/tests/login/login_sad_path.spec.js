'use strict';

const { test, expect } = require('@playwright/test');
const { LoginPage } = require('../../pages/Login.page');
const { TestData } = require('../../../config/testdata.config');

test.describe('Login - Sad Path', () => {
  test('locked_out_user sees error message', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const credentials = TestData.get('login.locked_out_user');

    await loginPage.goto();
    await loginPage.login(credentials.username, credentials.password);

    const errorMsg = await loginPage.getErrorMessage();
    expect(errorMsg).toContain('locked out');
  });

  test('invalid credentials shows error', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const credentials = TestData.get('login.invalid_user');

    await loginPage.goto();
    await loginPage.login(credentials.username, credentials.password);

    const errorMsg = await loginPage.getErrorMessage();
    expect(errorMsg).toContain('Username and password do not match');
  });
});
