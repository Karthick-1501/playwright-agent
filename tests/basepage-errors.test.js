'use strict';

// ── Unit tests for _isLocatorError classification ──
// Tests the REAL error classification logic exported from BasePage.
// This file does NOT require Playwright — it tests pure function logic.

const { _isLocatorError } = require('../src/pages/BasePage');

let passed = 0;
let failed = 0;

function assert(condition, label) {
    if (condition) {
        passed++;
    } else {
        failed++;
        console.error(`  FAIL: ${label}`);
    }
}

function makeError(name, message) {
    const err = new Error(message);
    err.name = name;
    return err;
}

// ── Test Suite ──

console.log('\n=== _isLocatorError Classification Tests ===\n');

// 1. Pure TimeoutError from action (click/fill) → locator error
console.log('1. Action TimeoutError → locator error');
{
    const err = makeError('TimeoutError', 'Timeout 30000ms exceeded. waiting for locator "[data-test=username]"');
    assert(_isLocatorError(err) === true, 'action timeout is a locator error');
}

// 2. Assertion timeout (toBeVisible) → NOT a locator error
console.log('2. Assertion timeout (toBeVisible) → NOT a locator error');
{
    const err = makeError('TimeoutError', 'Timed out 5000ms waiting for expect(received).toBeVisible()');
    assert(_isLocatorError(err) === false, 'assertion timeout toBeVisible is NOT a locator error');
}

// 3. Assertion timeout (toHaveText) → NOT a locator error
console.log('3. Assertion timeout (toHaveText) → NOT a locator error');
{
    const err = makeError('TimeoutError', 'Timed out 5000ms waiting for expect(received).toHaveText(expected)');
    assert(_isLocatorError(err) === false, 'assertion timeout toHaveText is NOT a locator error');
}

// 4. Assertion timeout (toHaveURL) → NOT a locator error
console.log('4. Assertion timeout (toHaveURL) → NOT a locator error');
{
    const err = makeError('TimeoutError', 'Timed out 5000ms waiting for expect(received).toHaveURL(expected)');
    assert(_isLocatorError(err) === false, 'assertion timeout toHaveURL is NOT a locator error');
}

// 5. Assertion mismatch (no timeout) → NOT a locator error
console.log('5. Assertion mismatch (no timeout) → NOT a locator error');
{
    const err = makeError('Error', 'expect(received).toHaveText(expected)\nExpected: "Hello"\nReceived: "World"');
    assert(_isLocatorError(err) === false, 'assertion value mismatch is NOT a locator error');
}

// 6. JestAssertionError → NOT a locator error
console.log('6. JestAssertionError → NOT a locator error');
{
    const err = makeError('JestAssertionError', 'Expected true, got false');
    assert(_isLocatorError(err) === false, 'JestAssertionError is NOT a locator error');
}

// 7. strict mode violation → locator error
console.log('7. strict mode violation → locator error');
{
    const err = makeError('Error', 'strict mode violation: locator resolved to 3 elements');
    assert(_isLocatorError(err) === true, 'strict mode violation is a locator error');
}

// 8. Element intercepted → locator error
console.log('8. Element intercepted → locator error');
{
    const err = makeError('Error', 'element is intercepted by another element');
    assert(_isLocatorError(err) === true, 'intercepted is a locator error');
}

// 9. Target closed → environment error
console.log('9. Target closed → environment error');
{
    const err = makeError('Error', 'Target closed');
    assert(_isLocatorError(err) === false, 'Target closed is NOT a locator error');
}

// 10. Network error → environment error
console.log('10. Network error → environment error');
{
    const err = makeError('Error', 'net::ERR_CONNECTION_REFUSED');
    assert(_isLocatorError(err) === false, 'net::ERR_ is NOT a locator error');
}

// 11. Browser crashed → environment error
console.log('11. Browser crashed → environment error');
{
    const err = makeError('Error', 'Browser process crashed');
    assert(_isLocatorError(err) === false, 'crashed is NOT a locator error');
}

// 12. Protocol error → environment error
console.log('12. Protocol error → environment error');
{
    const err = makeError('Error', 'Protocol error (Runtime.callFunctionOn)');
    assert(_isLocatorError(err) === false, 'Protocol error is NOT a locator error');
}

// 13. Detached from DOM → locator error
console.log('13. Detached from DOM → locator error');
{
    const err = makeError('Error', 'Element is detached from the DOM');
    assert(_isLocatorError(err) === true, 'detached from DOM is a locator error');
}

// 14. Expected/Received string patterns → NOT a locator error
console.log('14. Expected/Received string patterns → NOT a locator error');
{
    const err1 = makeError('Error', 'Expected string: "foo"');
    assert(_isLocatorError(err1) === false, 'Expected string is NOT a locator error');
    const err2 = makeError('Error', 'Received string: "bar"');
    assert(_isLocatorError(err2) === false, 'Received string is NOT a locator error');
}

// 15. Assertion timeout with "Timed out" + "expect(received)" combined
//     This is the EXACT edge case that was misclassified before the fix
console.log('15. Edge case: assertion timeout after page navigation');
{
    const err = makeError(
        'TimeoutError',
        'Timed out 5000ms waiting for expect(received).toBeVisible()\n\nLocator: locator(\'[data-test="inventory-item"]\')\nExpected: visible\nReceived: hidden\nCall log:\n  - waiting for locator'
    );
    assert(_isLocatorError(err) === false, 'assertion timeout with locator details is NOT a locator error');
}

// ── Results ──
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
