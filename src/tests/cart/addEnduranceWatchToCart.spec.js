const { test } = require('@playwright/test');
const { TestData } = require('../../../config/testdata.config');
const { HyvaHomePage } = require('../../pages/HyvaHome.page');

test.describe('Add Endurance Watch to Cart', () => {
  test('should add Endurance Watch to cart and verify minicart subtotal is visible', async ({ page }) => {
    const homePage = new HyvaHomePage(page);

    await homePage.navigate(TestData.get('hyvaHome.url'));
    await homePage.addEnduranceWatchToCart();
    await homePage.openMinicart();
    await homePage.assertMinicartSubtotalVisible();
  });
});
