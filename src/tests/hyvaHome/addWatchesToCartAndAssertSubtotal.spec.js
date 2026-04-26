const { test } = require('@playwright/test');
const { TestData } = require('../../../config/testdata.config');
const { HyvaHomePage } = require('../../pages/HyvaHome.page');

test.describe('HyvaHome — Add Watches to Cart and Assert Minicart Subtotal', () => {
  test('Add Aim Analog Watch and Endurance Watch to cart, compute subtotal, assert minicart subtotal matches', async ({ page }) => {
    const homePage = new HyvaHomePage(page);

    await homePage.navigate(TestData.get('hyvaHome.url'));

    const aimPrice = await homePage.getProductPrice('aimAnalogWatch');
    const endurancePrice = await homePage.getProductPrice('enduranceWatch');
    const expectedSubtotal = (parseFloat(aimPrice) + parseFloat(endurancePrice)).toFixed(2);

    await homePage.addAimAnalogWatchToCart();
    await homePage.addEnduranceWatchToCart();

    await homePage.openMinicart();
    await homePage.assertMinicartSubtotalVisible();
    await homePage.assertMinicartSubtotalEquals(expectedSubtotal);
  });
});
