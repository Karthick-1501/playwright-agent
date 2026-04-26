'use strict';

const { RegistryManager } = require('../registry/registry-manager');

// ── Lazy-loaded registry singleton ───────────────────────────────────────────
// The registry is NOT loaded at module init. Each Playwright worker process
// gets its own copy of this module, so eager loading would read a stale
// snapshot. Instead, _ensureRegistry() loads on first interaction, and
// _flushNow() uses mergeAndSave() to safely merge with other workers' writes.

let registry = null;

function _ensureRegistry() {
  if (!registry) {
    registry = new RegistryManager();
    registry.load();
  }
  return registry;
}

// ── Debounced write queue ────────────────────────────────────────────────────
// Accumulates registry mutations in memory during test execution and flushes
// to disk on a 500ms debounce. A process.on('exit') handler guarantees a
// final flush even if a test crashes mid-run. Uses mergeAndSave() to prevent
// parallel worker data loss.

let _flushTimer = null;
let _dirty = false;

function _scheduleSave() {
  _dirty = true;
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(_flushNow, 500);
}

function _flushNow() {
  if (!_dirty || !registry) return;
  try {
    registry.mergeAndSave();
    _dirty = false;
  } catch (_) {
    // Registry persistence is non-blocking — never crash a test run
  }
}

process.on('exit', _flushNow);
process.on('SIGINT', () => { _flushNow(); process.exit(130); });
process.on('SIGTERM', () => { _flushNow(); process.exit(143); });

// ── Locator introspection ────────────────────────────────────────────────────
// Extracts the locator string and tier from a locator builder function.
// e.g. (page) => page.locator('[data-test="username"]') → locator + tier 2

function _extractLocatorInfo(locatorFn) {
  try {
    const fnStr = locatorFn.toString();
    const match = fnStr.match(/=>\s*(.+)$/s);
    const locator = match ? match[1].trim() : null;
    if (!locator) return { locator: null, tier: null };

    let tier = null;
    if (/getByRole|getByLabel/.test(locator)) tier = 1;
    else if (/getByTestId|data-test|data-qa|data-testid/.test(locator)) tier = 2;
    // Tier 3: ID selectors (#id), class selectors (.class), attribute selectors ([attr]),
    // or any bare locator() call that didn't match tier 1/2
    else if (/locator\s*\(/.test(locator)) tier = 3;

    return { locator, tier };
  } catch (_) {
    return { locator: null, tier: null };
  }
}

// ── Error classification ─────────────────────────────────────────────────────
// Determines whether an error is caused by a broken selector (locator issue)
// or by an environmental/test-logic problem (flaky). Only locator errors
// should degrade selector health — environment errors must not poison the
// registry.

function _isLocatorError(err) {
  const msg = err.message || '';
  const name = err.name || '';

  // ── Environment errors — do NOT blame the selector ──
  if (msg.includes('Target closed')) return false;
  if (msg.includes('browser has been closed')) return false;
  if (msg.includes('Browser closed')) return false;
  if (msg.includes('net::ERR_')) return false;
  if (msg.includes('Navigation failed')) return false;
  if (msg.includes('crashed')) return false;
  if (msg.includes('Protocol error')) return false;
  if (msg.includes('Session closed')) return false;
  if (msg.includes('page.goto:')) return false;

  // ── Assertion errors — element was found, value/state was wrong ──
  // Playwright expect() throws with "expect(received).toHaveText(expected)"
  // or "expect(received).toBeVisible()" — including assertion timeouts.
  // These MUST be checked BEFORE the generic TimeoutError catch-all because
  // assertion timeouts produce a TimeoutError whose message also contains
  // "expect(received)", e.g. "Timed out ... expect(received).toBeVisible()".
  // The string "expect(received)" is exclusive to the assertion engine —
  // action methods (click, fill, textContent) never produce it.
  if (name === 'JestAssertionError') return false;
  if (msg.includes('expect(received)')) return false;
  if (msg.includes('Expected string:') || msg.includes('Received string:')) return false;

  // ── Selector errors — DO degrade health ──
  if (name === 'TimeoutError') return true;
  if (msg.includes('strict mode violation')) return true;
  if (msg.includes('Element is not')) return true;
  if (msg.includes('element is intercepted')) return true;
  if (msg.includes('Element is outside of the viewport')) return true;
  if (msg.includes('detached from the DOM')) return true;
  if (msg.includes('waiting for locator')) return true;
  if (msg.includes('resolved to')) return true;

  // ── Unknown — conservative: treat as locator error ──
  return true;
}

class BasePage {
  constructor(page) {
    this.page = page;
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  async navigate(url) {
    await this.page.goto(url);
  }

  // ── ActionEngine ─────────────────────────────────────────────────────────────
  // All interactions go through here so the registry can track success/failure.

  async fill(registryKey, locatorFn, value) {
    try {
      await locatorFn(this.page).fill(value);
      this._recordSuccess(registryKey, locatorFn);
    } catch (err) {
      if (_isLocatorError(err)) this._recordFailure(registryKey, locatorFn);
      throw err;
    }
  }

  async click(registryKey, locatorFn) {
    try {
      await locatorFn(this.page).click();
      this._recordSuccess(registryKey, locatorFn);
    } catch (err) {
      if (_isLocatorError(err)) this._recordFailure(registryKey, locatorFn);
      throw err;
    }
  }

  async selectOption(registryKey, locatorFn, value) {
    try {
      await locatorFn(this.page).selectOption(value);
      this._recordSuccess(registryKey, locatorFn);
    } catch (err) {
      if (_isLocatorError(err)) this._recordFailure(registryKey, locatorFn);
      throw err;
    }
  }

  async getText(registryKey, locatorFn) {
    try {
      const text = await locatorFn(this.page).textContent();
      this._recordSuccess(registryKey, locatorFn);
      return text;
    } catch (err) {
      if (_isLocatorError(err)) this._recordFailure(registryKey, locatorFn);
      throw err;
    }
  }

  async isVisible(registryKey, locatorFn) {
    try {
      const visible = await locatorFn(this.page).isVisible();
      this._recordSuccess(registryKey, locatorFn);
      return visible;
    } catch (err) {
      if (_isLocatorError(err)) this._recordFailure(registryKey, locatorFn);
      throw err;
    }
  }

  // ── AssertEngine ─────────────────────────────────────────────────────────────

  async assertVisible(registryKey, locatorFn) {
    try {
      const { expect } = require('@playwright/test');
      await expect(locatorFn(this.page)).toBeVisible();
      this._recordSuccess(registryKey, locatorFn);
    } catch (err) {
      if (_isLocatorError(err)) this._recordFailure(registryKey, locatorFn);
      throw err;
    }
  }

  async assertText(registryKey, locatorFn, expected) {
    try {
      const { expect } = require('@playwright/test');
      await expect(locatorFn(this.page)).toHaveText(expected);
      this._recordSuccess(registryKey, locatorFn);
    } catch (err) {
      if (_isLocatorError(err)) this._recordFailure(registryKey, locatorFn);
      throw err;
    }
  }

  // ── Registry Internals ───────────────────────────────────────────────────────

  _recordSuccess(registryKey, locatorFn) {
    if (!registryKey) return;
    try {
      const reg = _ensureRegistry();
      if (!reg.has(registryKey)) {
        const { locator, tier } = _extractLocatorInfo(locatorFn);
        const [page] = registryKey.split('.');
        reg.set(registryKey, {
          locator,
          tier,
          source_file: `src/elements/${page}.elements.js`,
        });
      }
      reg.recordSuccess(registryKey);
      _scheduleSave();
    } catch (_) {
      // Registry tracking is non-blocking — never fail a test because of it
    }
  }

  _recordFailure(registryKey, locatorFn) {
    if (!registryKey) return;
    try {
      const reg = _ensureRegistry();
      if (!reg.has(registryKey)) {
        const { locator, tier } = _extractLocatorInfo(locatorFn);
        const [page] = registryKey.split('.');
        reg.set(registryKey, {
          locator,
          tier,
          source_file: `src/elements/${page}.elements.js`,
        });
      }
      reg.recordFailure(registryKey);
      _scheduleSave();
    } catch (_) {
      // Registry tracking is non-blocking
    }
  }
}

module.exports = { BasePage, _isLocatorError, _extractLocatorInfo };
