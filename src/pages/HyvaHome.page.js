const el = require('../elements/HyvaHome.elements');
const { BasePage } = require('./BasePage');

class HyvaHomePage extends BasePage {
  constructor(page) {
    super(page);
  }

  async navigate(url) {
    await super.navigate(url);
  }

  async addLandoGymJacketToCart() {
    await this.click('HyvaHome.landoGymJacket', el.landoGymJacket);
    await this.click('HyvaHome.landoSizeXL', el.landoSizeXL);
    await this.click('HyvaHome.landoColorBlue', el.landoColorBlue);
    await this.click('HyvaHome.addToCartLandoGymJacket', el.addToCartLandoGymJacket);
  }

  async addIngridRunningJacketToCart() {
    await this.click('HyvaHome.ingridRunningJacket', el.ingridRunningJacket);
    await this.click('HyvaHome.ingridSizeXS', el.ingridSizeXS);
    await this.click('HyvaHome.ingridColorBlue', el.ingridColorBlue);
    await this.click('HyvaHome.addToCartIngridRunningJacket', el.addToCartIngridRunningJacket);
  }

  async addAimAnalogWatchToCart() {
    await this.click('HyvaHome.addToCartAimAnalogWatch', el.addToCartAimAnalogWatch);
  }

  async addEnduranceWatchToCart() {
    await this.click('HyvaHome.addToCartEnduranceWatch', el.addToCartEnduranceWatch);
  }

  async getProductPrice(elementKey) {
    const priceMap = {
      aimAnalogWatch: el.aimAnalogWatchPrice,
      enduranceWatch: el.enduranceWatchPrice
    };
    const locatorFn = priceMap[elementKey];
    const rawText = await this.getText(`HyvaHome.${elementKey}Price`, locatorFn);
    return rawText.replace(/[^0-9.]/g, '');
  }

  async openMinicart() {
    await this.click('HyvaHome.toggleMinicartCartIsEmpty', el.toggleMinicartCartIsEmpty);
  }

  async assertMinicartSubtotalVisible() {
    await this.assertVisible('HyvaHome.minicartSubtotal', el.minicartSubtotal);
  }

  async assertMinicartSubtotalEquals(expected) {
    const rawText = await this.getText('HyvaHome.minicartSubtotal', el.minicartSubtotal);
    const actual = parseFloat(rawText.replace(/[^0-9.]/g, ''));
    const expectedValue = typeof expected === 'string' ? parseFloat(expected.replace(/[^0-9.]/g, '')) : expected;
    
    const { expect } = require('@playwright/test');
    expect(actual).toBeCloseTo(expectedValue, 2);
  }

  async clickMinicartCheckout() {
    await this.click('HyvaHome.minicartCheckoutButton', el.minicartCheckoutButton);
  }
}

module.exports = { HyvaHomePage };
