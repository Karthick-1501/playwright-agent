'use strict';

const { test, expect } = require('@playwright/test');
const { HyvaLoginPage } = require('../../pages/HyvaLogin.page');
const { TestData } = require('../../../config/testdata.config');

test.describe('Hyva Login - Happy Path', () => {
  test('standard_user logs in successfully', async ({ page }) => {
    const loginPage = new HyvaLoginPage(page);
    const credentials = TestData.get('hyva_login.standard_user');

    await loginPage.goto();
    await loginPage.login(credentials.email, credentials.password);

    // After login, Magento/Hyva usually redirects to the customer account dashboard
    await expect(page).toHaveURL(/customer\/account/);
  });
});
