'use strict';

const { test, expect } = require('@playwright/test');
const { LoginPage } = require('../../pages/Login.page');
const { TestData } = require('../../../config/testdata.config');

test.describe('Login - Happy Path', () => {
  test('standard_user logs in and sees inventory page', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const credentials = TestData.get('login.standard_user');

    await loginPage.goto();
    await loginPage.login(credentials.username, credentials.password);

    await expect(page).toHaveURL(/inventory/);
  });
});
